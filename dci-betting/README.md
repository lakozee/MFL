# Marching Fantasy League (MFL)

A fantasy sports platform for DCI (Drum Corps International) where users create leagues, draft caption heads, and compete based on real performance scores.

## Features

- 🎪 Create leagues with 4-12 players
- 📨 Shareable invite links
- 🎯 Snake draft system (5 rounds)
- 👥 Team management
- 📊 Live scoring (coming soon)
- ⏱️ Real-time multiplayer draft (coming soon)

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: PostgreSQL
- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Authentication**: JWT with httpOnly cookies
- **Future**: Socket.io for real-time features

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up PostgreSQL database:
   ```bash
   createdb fantasy_dci
   psql fantasy_dci < database/schema.sql
   ```

4. Create `.env` file:
   ```
   NODE_ENV=development
   PORT=3000
   JWT_SECRET=your_secret_here
   DATABASE_URL=postgresql://localhost:5432/fantasy_dci
   ```

5. Start the server:
   ```bash
   npm start
   ```

6. Visit `http://localhost:3000`

## Deployment

See `docs/deployment_guide.md` for production deployment instructions.

## License

MIT
