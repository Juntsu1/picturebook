import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { profilesRouter } from './routes/profiles.js';
import { booksRouter } from './routes/books.js';
import { charactersRouter } from './routes/characters.js';
import { templatesRouter } from './routes/templates.js';
import { chatStoriesRouter } from './routes/chat-stories.js';
import { initFirebase } from './lib/firebase.js';
import { errorHandler } from './middleware/error-handler.js';

// Initialize Firebase
initFirebase();

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json());

// Routes
app.use('/api/auth', authRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/books', booksRouter);
app.use('/api/characters', charactersRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/chat-stories', chatStoriesRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Global error handler — must be registered last
app.use(errorHandler);

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
