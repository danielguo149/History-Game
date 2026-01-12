const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GOOGLE_API_KEY;

// Google Gemini API call function
async function callGemini(systemPrompt, userPrompt) {
    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    console.log('Calling Gemini API...');

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
            }],
            generationConfig: {
                temperature: 0.9,
                maxOutputTokens: 2000
            }
        })
    });

    const responseText = await response.text();

    if (!response.ok) {
        console.error('Gemini API error response:', responseText);
        throw new Error(`Gemini API error (${response.status}): ${responseText}`);
    }

    const data = JSON.parse(responseText);

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        console.error('Unexpected Gemini response structure:', JSON.stringify(data, null, 2));
        throw new Error('Unexpected response structure from Gemini API');
    }

    console.log('Gemini API response received successfully');
    return data.candidates[0].content.parts[0].text;
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
    return JSON.parse(text.trim());
}

// Generate a new historical scenario
app.post('/api/generate-scenario', async (req, res) => {
    try {
        const { era, previousLeaders = [] } = req.body;

        const eraPrompts = {
            all: "any time period from ancient history to the 20th century",
            ancient: "the ancient world (3000 BCE - 500 CE), such as Egypt, Greece, Rome, Persia, or China",
            medieval: "the medieval period (500 CE - 1400 CE), including the Byzantine Empire, Islamic Golden Age, Crusades, or feudal Europe/Asia",
            renaissance: "the Renaissance and Early Modern period (1400 - 1700), including the Age of Exploration, Reformation, and Scientific Revolution",
            modern: "the Modern era (1700 - 1900), including revolutions, colonialism, and nation-building",
            contemporary: "the 20th century (1900 - 2000), including world wars, cold war, civil rights movements, and decolonization"
        };

        const excludeList = previousLeaders.length > 0
            ? `Do NOT use any of these leaders who have already appeared: ${previousLeaders.join(', ')}.`
            : '';

        const systemPrompt = "You are a brilliant historian specializing in lesser-known but pivotal moments in history. You always respond with valid JSON only, no markdown formatting or extra text.";

        const userPrompt = `You are a historical expert creating an educational game. Generate a historically accurate and dramatic scenario about a real historical leader facing a critical decision.

IMPORTANT REQUIREMENTS:
- Choose OBSCURE or lesser-known historical figures and events - AVOID famous stories like Caesar crossing the Rubicon, Washington crossing the Delaware, Churchill during WWII, etc.
- Pick moments that are historically significant but not commonly taught in schools
- The correct choice should NOT be obvious - all 4 options should seem equally reasonable

Time Period: ${eraPrompts[era] || eraPrompts.all}
${excludeList}

Create a scenario with:
1. A real but lesser-known historical leader who faced a genuine difficult choice
2. Accurate historical context leading up to the decision (1-2 paragraphs, not too complicated)
3. FOUR distinct choices they could have made - all should seem plausible
4. The scenario should be dramatic, engaging, and teach something surprising about history

Respond in this exact JSON format:
{
    "era": "specific year and location",
    "leader": "full name of the historical figure",
    "title": "their title/position at the time",
    "context": "1-2 paragraphs of vivid, accurate historical context setting up the dilemma (make it dramatic and engaging)",
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
    "historicalFact": "what actually happened and why it mattered in 2-3 sentences"
}

Only ONE choice should have isHistorical: true. All four choices should seem equally reasonable given the circumstances - make it genuinely difficult to guess which one is correct!`;

        const responseText = await callGemini(systemPrompt, userPrompt);
        const scenario = parseAIResponse(responseText);
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
        const { scenario, playerChoice, isHistoricalChoice } = req.body;

        const systemPrompt = "You are a brilliant historian specializing in counterfactual history. You always respond with valid JSON only, no markdown formatting or extra text.";

        const userPrompt = `You are a historical expert. A player is playing a history game where they made a choice as ${scenario.leader}.

SCENARIO:
Era: ${scenario.era}
Leader: ${scenario.leader} (${scenario.title})
Context: ${scenario.context}
Dilemma: ${scenario.dilemma}

THE PLAYER CHOSE: "${playerChoice}"

This ${isHistoricalChoice ? 'IS' : 'is NOT'} what ${scenario.leader} actually chose historically.

Historical fact: ${scenario.historicalFact}

Generate a response in this exact JSON format:
{
    "matchedHistory": ${isHistoricalChoice},
    "whatActuallyHappened": "2-3 paragraphs describing what ${scenario.leader} actually did and the real historical consequences - make it vivid and interesting",
    "alternateHistory": "2-3 paragraphs of plausible alternate history - what likely would have happened if the ${isHistoricalChoice ? 'other choice' : "player's choice"} had been made. Be specific about potential consequences, consider butterfly effects, and make it thought-provoking",
    "funFact": "one fascinating lesser-known fact about this historical moment or person",
    "lessonsLearned": "what this moment teaches us about leadership, decision-making, or human nature"
}

Make both outcomes engaging and educational. The alternate history should be plausible based on the actual historical circumstances.`;

        const responseText = await callGemini(systemPrompt, userPrompt);
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
    res.json({ status: 'ok', apiConfigured: !!GEMINI_API_KEY });
});

app.listen(PORT, () => {
    console.log(`\n🏛️  Crossroads of History server running on port ${PORT}`);
    console.log(`   Open http://localhost:${PORT} in your browser\n`);
    if (!GEMINI_API_KEY) {
        console.warn('⚠️  Warning: GOOGLE_API_KEY not set in .env file\n');
    } else {
        console.log('✅ Gemini API key configured\n');
    }
});
