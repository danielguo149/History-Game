# Crossroads of History

An interactive historical decision-making game where you face the same difficult choices as history's greatest leaders. After each choice, discover what actually happened and explore alternate history scenarios.

## Features

- **Dynamic AI-Generated Scenarios**: Each playthrough is unique with scenarios generated on-the-fly
- **Multiple Time Periods**: Ancient, Medieval, Renaissance, Modern, and 20th Century
- **Real Historical Dilemmas**: Face the same choices as Julius Caesar, Cleopatra, Churchill, and more
- **Alternate History**: Learn what might have happened if different choices were made
- **Educational**: Fun facts and lessons from each historical moment

## Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/danielguo149/History-Game.git
   cd History-Game
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file with your API key:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and add either:
   - `GOOGLE_API_KEY` - Google Gemini API (free tier available)
   - `OPENAI_API_KEY` - OpenAI API

4. Start the server:
   ```bash
   npm start
   ```

5. Open http://localhost:3000 in your browser

## How to Play

1. Select a time period (or choose "All Eras" for variety)
2. Read the historical scenario and context
3. Make your choice - what would you do?
4. Discover if you matched history's path
5. Learn what actually happened and what might have been
6. Complete 5 rounds and see your final score

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Backend**: Node.js with Express
- **AI**: Google Gemini or OpenAI GPT-4

## License

MIT
