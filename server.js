const express = require('express');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Route 1: Add words in batches of 50
// POST /api/vocabulary/bulk
app.post('/api/vocabulary/bulk', async (req, res) => {
  try {
    const { words, offset = 0 } = req.body; // Expecting {words: [...], offset: number}
    
    // Validate input
    if (!Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Invalid input. Expected words array.' });
    }

    // Get 50 words starting from offset
    const batch = words.slice(offset, offset + 50);
    
    if (batch.length === 0) {
      return res.status(200).json({
        message: 'No more words to add',
        completed: true,
        totalProcessed: offset
      });
    }

    const { data, error } = await supabase
      .from('vocabulary')
      .insert(batch)
      .select();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const newOffset = offset + batch.length;
    const hasMore = newOffset < words.length;

    res.status(201).json({
      message: 'Batch added successfully',
      batchSize: data.length,
      totalProcessed: newOffset,
      totalWords: words.length,
      hasMore,
      nextOffset: hasMore ? newOffset : null,
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
    // First, get the total count
    const { count, error: countError } = await supabase
      .from('vocabulary')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      return res.status(400).json({ error: countError.message });
    }

    // If less than 10 words, return all
    const limit = Math.min(10, count);

    // Get random words using PostgreSQL's random() function
    const { data, error } = await supabase
      .from('vocabulary')
      .select('word, meaning, synonyms')
      .order('random()')
      .limit(limit);

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