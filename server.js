const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Helper function to get group name using Gemini AI
async function getGroupNameForWords(newWords, existingGroups) {
  try {
    const prompt = `You are a vocabulary grouping assistant. Your task is to assign group names to new words based on their meanings.

Existing groups in database:
${existingGroups.length > 0 ? existingGroups.map(g => `- "${g}"`).join('\n') : 'No existing groups yet'}

New words to categorize:
${newWords.map(w => `Word: "${w.word}" - Meaning: "${w.meaning}"`).join('\n')}

Rules:
1. If a new word's meaning matches an existing group, assign it to that group
2. If no existing group matches, create a NEW simple group name (2-4 words max)
3. Group names should be simple, easy meanings like "feeling happy", "movement verbs", "time related", etc.
4. Multiple new words with similar meanings should get the SAME group name
5. Be consistent - similar meanings = same group

Return ONLY a valid JSON array with this exact structure:
[
  {
    "word": "word1",
    "group_name": "simple group name"
  },
  {
    "word": "word2", 
    "group_name": "simple group name"
  }
]

Return ONLY the JSON array, no other text.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text();
    
    // Clean up response
    const cleanedText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const groupAssignments = JSON.parse(cleanedText);
    return groupAssignments;
    
  } catch (error) {
    console.error('Error getting group names from AI:', error);
    // Fallback: return words without groups
    return newWords.map(w => ({ word: w.word, group_name: null }));
  }
}

// Route 1: Add words with AI grouping (skip duplicates)
// POST /api/vocabulary/bulk
app.post('/api/vocabulary/bulk', async (req, res) => {
  try {
    const { words } = req.body;
    
    if (!Array.isArray(words) || words.length === 0) {
      return res.status(400).json({ error: 'Invalid input. Expected words array.' });
    }

    // Step 1: Get all existing group names from database
    const { data: existingGroupsData, error: groupError } = await supabase
      .from('vocabulary')
      .select('group_name')
      .not('group_name', 'is', null);

    if (groupError) {
      console.error('Error fetching existing groups:', groupError);
    }

    // Extract unique group names
    const existingGroups = existingGroupsData 
      ? [...new Set(existingGroupsData.map(item => item.group_name).filter(Boolean))]
      : [];

    console.log('Existing groups:', existingGroups);

    // Step 2: Use AI to assign groups to new words
    let groupAssignments = [];
    try {
      groupAssignments = await getGroupNameForWords(words, existingGroups);
      console.log('AI group assignments:', groupAssignments);
    } catch (aiError) {
      console.error('AI grouping failed, proceeding without groups:', aiError);
    }

    // Step 3: Process each word with assigned group
    const results = {
      added: [],
      skipped: [],
      errors: []
    };

    for (const word of words) {
      try {
        // Find the group assignment for this word
        const assignment = groupAssignments.find(a => a.word === word.word);
        const groupName = assignment ? assignment.group_name : null;

        const { data, error } = await supabase
          .from('vocabulary')
          .insert([{
            word: word.word,
            meaning: word.meaning,
            synonyms: word.synonyms || [],
            group_name: groupName
          }])
          .select();

        if (error) {
          if (error.code === '23505' || error.message.includes('duplicate')) {
            results.skipped.push(word.word);
          } else {
            results.errors.push({
              word: word.word,
              error: error.message
            });
          }
        } else if (data && data.length > 0) {
          results.added.push(data[0]);
        }
      } catch (err) {
        results.errors.push({
          word: word.word,
          error: err.message
        });
      }
    }

    res.status(201).json({
      message: 'Bulk insert completed with AI grouping',
      totalSent: words.length,
      addedCount: results.added.length,
      skippedCount: results.skipped.length,
      errorCount: results.errors.length,
      aiGroupingUsed: groupAssignments.length > 0,
      results
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Route 2: Get all words from database
// GET /api/vocabulary
app.get('/api/vocabulary', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const offset = (page - 1) * limit;

    // Get total count
    const { count, error: countError } = await supabase
      .from('vocabulary')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      return res.status(400).json({ error: countError.message });
    }

    // Get paginated data
    const { data, error } = await supabase
      .from('vocabulary')
      .select('word, meaning, synonyms, group_name')
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.status(200).json({
      data: data,
      pagination: {
        page: page,
        limit: limit,
        total: count,
        totalPages: Math.ceil(count / limit),
        hasMore: offset + limit < count
      }
    });
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

// Route 5: Get all word groups
// GET /api/vocabulary/groups
app.get('/api/vocabulary/groups', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vocabulary')
      .select('word, meaning, synonyms, group_name')
      .not('group_name', 'is', null)
      .order('group_name', { ascending: true });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Group words by group_name
    const groups = {};
    data.forEach(word => {
      if (!groups[word.group_name]) {
        groups[word.group_name] = [];
      }
      groups[word.group_name].push({
        word: word.word,
        meaning: word.meaning,
        synonyms: word.synonyms
      });
    });

    res.status(200).json(groups);
  } catch (err) {
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Gemini AI configured: ${!!process.env.GEMINI_API_KEY}`);
});