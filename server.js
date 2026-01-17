const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

const SCENARIO_CACHE_SIZE = 6;
const scenarioCache = new Map();
const scenarioPrefillInFlight = new Map();

// DeepSeek API call function (OpenAI-compatible)
async function callDeepSeek(systemPrompt, userPrompt, options = {}) {
    console.log('Calling DeepSeek API...');
    const { maxTokens = 900, temperature = 0.7 } = options;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
            model: DEEPSEEK_MODEL,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature,
            max_tokens: maxTokens
        })
    });

    const responseText = await response.text();

    if (!response.ok) {
        console.error('DeepSeek API error response:', responseText);
        throw new Error(`DeepSeek API error (${response.status}): ${responseText}`);
    }

    const data = JSON.parse(responseText);

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        console.error('Unexpected DeepSeek response structure:', JSON.stringify(data, null, 2));
        throw new Error('Unexpected response structure from DeepSeek API');
    }

    console.log('DeepSeek API response received successfully');
    return data.choices[0].message.content;
}

// Parse JSON from AI response (handles markdown code blocks)
function parseAIResponse(responseText) {
    let text = responseText.trim();
    if (text.startsWith('```json')) {
        text = text.slice(7);
    }
    if (text.startsWith('```')) {
        text = text.slice(3);
    }
    if (text.endsWith('```')) {
        text = text.slice(0, -3);
    }
    try {
        return JSON.parse(text.trim());
    } catch (error) {
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(text.slice(start, end + 1));
        }
        throw error;
    }
}

function scenarioKey(scenario) {
    return `${scenario.leader}||${scenario.era}||${scenario.dilemma}`;
}

function getScenarioCacheKey(era, language) {
    return `${era || 'all'}::${language || 'en'}`;
}

function getScenarioCacheList(key) {
    if (!scenarioCache.has(key)) {
        scenarioCache.set(key, []);
    }
    return scenarioCache.get(key);
}

function resolveEraDescription(era, customEra) {
    const eraPrompts = {
        all: "any time period from ancient history to the 20th century",
        ancient: "the ancient world (3000 BCE - 500 CE), such as Egypt, Greece, Rome, Persia, or China",
        medieval: "the medieval period (500 CE - 1400 CE), including the Byzantine Empire, Islamic Golden Age, Crusades, or feudal Europe/Asia",
        renaissance: "the Renaissance and Early Modern period (1400 - 1700), including the Age of Exploration, Reformation, and Scientific Revolution",
        modern: "the Modern era (1700 - 1900), including revolutions, colonialism, and nation-building",
        contemporary: "the 20th century (1900 - 2000), including world wars, cold war, civil rights movements, and decolonization"
    };

    if (customEra && customEra.trim()) {
        return customEra.trim();
    }

    return eraPrompts[era] || eraPrompts.all;
}

function buildScenarioPrompts({ era, previousLeaders, language, customEra, customContext, previousEventSummaries }) {
    const eraDescription = resolveEraDescription(era, customEra);
    const excludeList = previousLeaders.length > 0
        ? `Do NOT use any of these leaders who have already appeared: ${previousLeaders.join(', ')}.`
        : '';
    const customContextNote = customContext && customContext.trim()
        ? `Player-provided historical context to weave in: ${customContext.trim()}`
        : '';
    const previousEventsNote = previousEventSummaries && previousEventSummaries.length > 0
        ? `Do NOT repeat any of these historical situations: ${previousEventSummaries.join(' | ')}`
        : '';

    const languageNote = language === 'zh'
        ? 'All string values must be written in Simplified Chinese. Keep JSON keys and booleans in English.'
        : 'All string values must be written in English. Keep JSON keys and booleans in English.';

    const systemPrompt = "You are a brilliant historian specializing in lesser-known but pivotal moments in history. You always respond with valid JSON only, no markdown formatting or extra text.";

    const userPrompt = `You are a historical expert creating an educational game. Generate a historically accurate and dramatic scenario about a real historical leader facing a critical decision.

IMPORTANT REQUIREMENTS:
- Choose OBSCURE or lesser-known historical figures and events - AVOID famous stories like Caesar crossing the Rubicon, Washington crossing the Delaware, Churchill during WWII, etc.
- Pick moments that are historically significant but not commonly taught in schools
- The correct choice should NOT be obvious - all 4 options should seem equally reasonable

Time Period: ${eraDescription}
${excludeList}
${languageNote}
${customContextNote}
${previousEventsNote}

Create a scenario with:
1. A real but lesser-known historical leader who faced a genuine difficult choice
2. Accurate historical context leading up to the decision (1 paragraph, concise and engaging)
3. FOUR distinct choices they could have made - all should seem plausible
4. The scenario should be dramatic, engaging, and teach something surprising about history

Respond in this exact JSON format:
{
    "era": "specific year and location",
    "leader": "full name of the historical figure",
    "title": "their title/position at the time",
    "context": "1 concise paragraph of vivid, accurate historical context setting up the dilemma (make it dramatic and engaging)",
    "dilemma": "a single compelling question presenting the choice",
    "choices": [
        {
            "text": "first option - a clear course of action",
            "isHistorical": true or false
        },
        {
            "text": "second option - another plausible course of action",
            "isHistorical": true or false
        },
        {
            "text": "third option - another plausible course of action",
            "isHistorical": true or false
        },
        {
            "text": "fourth option - another plausible course of action",
            "isHistorical": true or false
        }
    ],
    "historicalFact": "what actually happened and why it mattered in 1-2 sentences"
}

Only ONE choice should have isHistorical: true. All four choices should seem equally reasonable given the circumstances - make it genuinely difficult to guess which one is correct!`;

    return { systemPrompt, userPrompt };
}

async function generateScenario({ era, previousLeaders, language, customEra, customContext, previousEventSummaries, maxTokens }) {
    const { systemPrompt, userPrompt } = buildScenarioPrompts({
        era,
        previousLeaders,
        language,
        customEra,
        customContext,
        previousEventSummaries
    });

    const responseText = await callDeepSeek(systemPrompt, userPrompt, {
        maxTokens: maxTokens || 700,
        temperature: 0.7
    });

    return parseAIResponse(responseText);
}

async function prefillScenarioCache(era, language) {
    const cacheKey = getScenarioCacheKey(era, language);
    const cacheList = getScenarioCacheList(cacheKey);
    const inFlight = scenarioPrefillInFlight.get(cacheKey) || 0;

    if (cacheList.length >= SCENARIO_CACHE_SIZE || inFlight > 0) {
        return;
    }

    scenarioPrefillInFlight.set(cacheKey, inFlight + 1);
    try {
        const scenario = await generateScenario({
            era,
            previousLeaders: [],
            language,
            customEra: null,
            maxTokens: 900
        });
        cacheList.push(scenario);
    } catch (error) {
        console.warn('Scenario prefill failed:', error.message);
    } finally {
        const remaining = (scenarioPrefillInFlight.get(cacheKey) || 1) - 1;
        if (remaining <= 0) {
            scenarioPrefillInFlight.delete(cacheKey);
        } else {
            scenarioPrefillInFlight.set(cacheKey, remaining);
        }
    }
}

// Generate a new historical scenario
app.post('/api/generate-scenario', async (req, res) => {
    try {
        const {
            era = 'all',
            previousLeaders = [],
            previousEventKeys = [],
            previousEventSummaries = [],
            language = 'en',
            customEra = '',
            customContext = ''
        } = req.body;
        const hasCustomEra = typeof customEra === 'string' && customEra.trim().length > 0;
        const hasCustomContext = typeof customContext === 'string' && customContext.trim().length > 0;
        const hasPreviousEvents = Array.isArray(previousEventKeys) && previousEventKeys.length > 0;
        const cacheKey = getScenarioCacheKey(era, language);
        const cacheList = getScenarioCacheList(cacheKey);

        let scenario = null;
        if (!hasCustomEra && !hasCustomContext && cacheList.length > 0) {
            const index = cacheList.findIndex(item => {
                if (previousLeaders.includes(item.leader)) {
                    return false;
                }
                if (hasPreviousEvents) {
                    return !previousEventKeys.includes(scenarioKey(item));
                }
                return true;
            });
            if (index !== -1) {
                scenario = cacheList.splice(index, 1)[0];
            }
        }

        if (!scenario) {
            scenario = await generateScenario({
                era,
                previousLeaders,
                language,
                customEra,
                customContext,
                previousEventSummaries
            });
        }

        if (!hasCustomEra && !hasCustomContext) {
            setImmediate(() => {
                prefillScenarioCache(era, language);
            });
        }

        res.json(scenario);

    } catch (error) {
        console.error('Error generating scenario:', error);
        res.status(500).json({
            error: 'Failed to generate scenario',
            details: error.message
        });
    }
});

// Generate outcome based on player's choice
app.post('/api/generate-outcome', async (req, res) => {
    try {
        const { scenario, playerChoice, isHistoricalChoice, language = 'en' } = req.body;

        const systemPrompt = "You are a brilliant historian specializing in counterfactual history. You always respond with valid JSON only, no markdown formatting or extra text.";
        const languageNote = language === 'zh'
            ? 'All string values must be written in Simplified Chinese. Keep JSON keys and booleans in English.'
            : 'All string values must be written in English. Keep JSON keys and booleans in English.';

        const userPrompt = `You are a historical expert. A player is playing a history game where they made a choice as ${scenario.leader}.

SCENARIO:
Era: ${scenario.era}
Leader: ${scenario.leader} (${scenario.title})
Context: ${scenario.context}
Dilemma: ${scenario.dilemma}

THE PLAYER CHOSE: "${playerChoice}"

This ${isHistoricalChoice ? 'IS' : 'is NOT'} what ${scenario.leader} actually chose historically.

Historical fact: ${scenario.historicalFact}
${languageNote}

Generate a response in this exact JSON format:
{
    "matchedHistory": ${isHistoricalChoice},
    "whatActuallyHappened": "1 concise paragraph describing what ${scenario.leader} actually did and the real historical consequences - make it vivid and interesting",
    "alternateHistory": "1 concise paragraph of plausible alternate history - what likely would have happened if the ${isHistoricalChoice ? 'other choice' : "player's choice"} had been made. Be specific about potential consequences, consider butterfly effects, and make it thought-provoking",
    "funFact": "one fascinating lesser-known fact about this historical moment or person",
    "lessonsLearned": "what this moment teaches us about leadership, decision-making, or human nature. Make sure it's not too complicated."
}

Make both outcomes engaging and educational. The alternate history should be plausible based on the actual historical circumstances.`;

        const responseText = await callDeepSeek(systemPrompt, userPrompt, {
            maxTokens: 950,
            temperature: 0.7
        });
        const outcome = parseAIResponse(responseText);
        res.json(outcome);

    } catch (error) {
        console.error('Error generating outcome:', error);
        res.status(500).json({
            error: 'Failed to generate outcome',
            details: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', apiConfigured: !!DEEPSEEK_API_KEY });
});

app.listen(PORT, () => {
    console.log(`\n🏛️  Crossroads of History server running on port ${PORT}`);
    console.log(`   Open http://localhost:${PORT} in your browser\n`);
    if (!DEEPSEEK_API_KEY) {
        console.warn('⚠️  Warning: DEEPSEEK_API_KEY not set in .env file\n');
    } else {
        console.log('✅ DeepSeek API key configured\n');
    }
});
