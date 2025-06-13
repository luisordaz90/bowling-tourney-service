// controllers/playerController.js
const { query, withTransaction } = require('../config/database');

const createPlayer = async (req, res) => {
  try {
    const { name, email, phone, handicap } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Player name is required' });
    }

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    const result = await query(
      `INSERT INTO players (name, email, phone, handicap)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, email || null, phone || null, handicap ? parseInt(handicap) : 0]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating player:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'players_email_key') {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }
    
    res.status(500).json({ error: 'Failed to create player' });
  }
};

const getPlayers = async (req, res) => {
  try {
    const result = await query('SELECT * FROM players ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching players:', error);
    res.status(500).json({ error: 'Failed to fetch players' });
  }
};

const getPlayerById = async (req, res) => {
  try {
    const result = await query('SELECT * FROM players WHERE id = $1', [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ error: 'Failed to fetch player' });
  }
};

const updatePlayer = async (req, res) => {
  try {
    const { name, email, phone, handicap } = req.body;

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
    }

    const updateFields = [];
    const updateValues = [];
    let paramCounter = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCounter++}`);
      updateValues.push(name);
    }
    if (email !== undefined) {
      updateFields.push(`email = $${paramCounter++}`);
      updateValues.push(email);
    }
    if (phone !== undefined) {
      updateFields.push(`phone = $${paramCounter++}`);
      updateValues.push(phone);
    }
    if (handicap !== undefined) {
      updateFields.push(`handicap = $${paramCounter++}`);
      updateValues.push(parseInt(handicap));
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    updateValues.push(req.params.id);

    const result = await query(
      `UPDATE players SET ${updateFields.join(', ')} WHERE id = $${paramCounter} RETURNING *`,
      updateValues
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating player:', error);
    
    // Handle unique constraint violations
    if (error.code === '23505') {
      if (error.constraint === 'players_email_key') {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }
    
    res.status(500).json({ error: 'Failed to update player' });
  }
};

const deletePlayer = async (req, res) => {
  try {
    await withTransaction(async (client) => {
      // Check if player exists
      const playerResult = await client.query('SELECT id FROM players WHERE id = $1', [req.params.id]);
      if (playerResult.rows.length === 0) {
        throw new Error('Player not found');
      }

      // Check if player has recorded scores
      const scoresResult = await client.query(
        'SELECT COUNT(*) FROM player_match_scores WHERE player_id = $1',
        [req.params.id]
      );
      
      if (parseInt(scoresResult.rows[0].count) > 0) {
        throw new Error('Cannot delete player with recorded match scores. Player data is needed for historical records.');
      }

      // Delete the player (cascade will handle related records)
      await client.query('DELETE FROM players WHERE id = $1', [req.params.id]);
    });

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting player:', error);
    
    if (error.message === 'Player not found') {
      return res.status(404).json({ error: error.message });
    }
    
    if (error.message.includes('Cannot delete player with recorded match scores')) {
      return res.status(400).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to delete player' });
  }
};

const getPlayersByTeam = async (req, res) => {
  try {
    const result = await query(
      `SELECT p.*, tp.role, tp.is_active, tp.joined_date, tp.left_date
       FROM players p
       JOIN team_players tp ON p.id = tp.player_id
       WHERE tp.team_id = $1 AND tp.is_active = true
       ORDER BY tp.role, p.name`,
      [req.params.teamId]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching team players:', error);
    res.status(500).json({ error: 'Failed to fetch team players' });
  }
};

module.exports = {
  createPlayer,
  getPlayers,
  getPlayerById,
  updatePlayer,
  deletePlayer,
  getPlayersByTeam
};