const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Route 1: Add words (skip duplicates)
// POST /api/vocabulary/bulk
app.post('/api/vocabulary/bulk', async (req, res) => {
  try {
    const { words } = req.body; // Expecting {words: [...]}
    
    // Validate input
    if (!Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Invalid input. Expected words array.' });
    }

    // Use ignoreDuplicates to skip existing words
    const { data, error } = await supabase
      .from('vocabulary')
      .insert(words, { ignoreDuplicates: true })
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(201).json({
      message: 'Words added successfully',
      totalSent: words.length,
      addedCount: data ? data.length : 0, // Actual number of new words added
      skippedCount: words.length - (data ? data.length : 0), // Duplicates skipped
      data
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 2: Get all words from database
// GET /api/vocabulary
app.get('/api/vocabulary', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vocabulary')
      .select('word, meaning, synonyms')
      .order('word', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 3: Delete a specific word
// DELETE /api/vocabulary/:word
app.delete('/api/vocabulary/:word', async (req, res) => {
  try {
    const { word } = req.params;

    const { data, error } = await supabase
      .from('vocabulary')
      .delete()
      .eq('word', word)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    if (data.length === 0) {
      return res.status(404).json({ error: 'Word not found' });
    }

    res.status(200).json({
      message: 'Word deleted successfully',
      deleted: data[0]
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 4: Get 10 random words
// GET /api/vocabulary/random
app.get('/api/vocabulary/random', async (req, res) => {
  try {
    const { data, error } = await supabase
      .rpc('get_random_vocabulary', { limit_count: 10 });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});