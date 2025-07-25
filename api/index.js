const express = require("express");
const path = require("path");
const cors = require("cors");
const { Pool } = require("pg");
const { verifyToken } = require("../firebaseAdmin.js");
require("dotenv").config();

const { DATABASE_URL } = process.env;

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Debug: Check Postgres version
async function checkPostgresConnection() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT version()");
    console.log("Connected to:", res.rows[0].version);
  } finally {
    client.release();
  }
}
checkPostgresConnection();

// === TRIPS ENDPOINTS ===

// Create a new trip
app.post("/trips", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { uid } = req.user;
    const {
      title,
      country,
      city,
      start_date,
      end_date,
      notes,
      image_url,
      trip_type = 'vacation',
      budget,
      traveler_count = 1
    } = req.body;

    const result = await client.query(
      `INSERT INTO trips (user_firebase_uid, title, country, city, start_date, end_date, notes, image_url, trip_type, budget, traveler_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [uid, title, country, city, start_date, end_date, notes, image_url, trip_type, budget, traveler_count]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Create trip error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get all trips with enhanced data
app.get("/trips", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { uid } = req.user;

    // Use the enhanced view for richer data
    const result = await client.query(
      `SELECT 
        t.*,
        get_trip_status(t.start_date, t.end_date) as trip_status,
        get_trip_days_info(t.start_date, t.end_date) as days_info,
        (t.end_date - t.start_date + 1) as duration_days,
        COUNT(DISTINCT d.id) as destination_count,
        COUNT(DISTINCT p.id) as photo_count,
        COUNT(DISTINCT CASE WHEN d.is_completed THEN d.id END) as completed_destinations
       FROM trips t
       LEFT JOIN destinations d ON t.id = d.trip_id
       LEFT JOIN photos p ON t.id = p.trip_id
       WHERE t.user_firebase_uid = $1
       GROUP BY t.id
       ORDER BY t.start_date DESC`,
      [uid]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch trips error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get one trip by ID with enhanced data
app.get("/trips/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT 
        t.*,
        get_trip_status(t.start_date, t.end_date) as trip_status,
        get_trip_days_info(t.start_date, t.end_date) as days_info,
        (t.end_date - t.start_date + 1) as duration_days,
        COUNT(DISTINCT d.id) as destination_count,
        COUNT(DISTINCT p.id) as photo_count,
        COUNT(DISTINCT CASE WHEN d.is_completed THEN d.id END) as completed_destinations
       FROM trips t
       LEFT JOIN destinations d ON t.id = d.trip_id
       LEFT JOIN photos p ON t.id = p.trip_id
       WHERE t.id = $1
       GROUP BY t.id`,
      [req.params.id]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: "Trip not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch trip error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Update a trip
app.put("/trips/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      title,
      country,
      city,
      start_date,
      end_date,
      notes,
      image_url,
      trip_type,
      budget,
      traveler_count,
      is_favorite,
      trip_rating
    } = req.body;

    await client.query(
      `UPDATE trips SET 
        title = $1, 
        country = $2, 
        city = $3, 
        start_date = $4, 
        end_date = $5, 
        notes = $6, 
        image_url = $7,
        trip_type = COALESCE($8, trip_type),
        budget = COALESCE($9, budget),
        traveler_count = COALESCE($10, traveler_count),
        is_favorite = COALESCE($11, is_favorite),
        trip_rating = COALESCE($12, trip_rating)
       WHERE id = $13`,
      [title, country, city, start_date, end_date, notes, image_url, trip_type, budget, traveler_count, is_favorite, trip_rating, req.params.id]
    );

    res.json({ message: "Trip updated successfully" });
  } catch (err) {
    console.error("Update trip error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Toggle favorite status for a trip
app.patch("/trips/:id/favorite", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "UPDATE trips SET is_favorite = NOT is_favorite WHERE id = $1 RETURNING is_favorite",
      [req.params.id]
    );

    res.json({ is_favorite: result.rows[0].is_favorite });
  } catch (err) {
    console.error("Toggle favorite error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Rate a trip
app.patch("/trips/:id/rating", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rating } = req.body;

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    await client.query(
      "UPDATE trips SET trip_rating = $1 WHERE id = $2",
      [rating, req.params.id]
    );

    res.json({ message: "Trip rated successfully" });
  } catch (err) {
    console.error("Rate trip error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Delete a trip
app.delete("/trips/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM trips WHERE id = $1", [req.params.id]);
    res.json({ message: "Trip deleted successfully" });
  } catch (err) {
    console.error("Delete trip error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// === DESTINATIONS ===

// Get destinations for a trip (enhanced)
app.get("/destinations", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { trip_id } = req.query;
    const result = await client.query(
      `SELECT * FROM destinations 
       WHERE trip_id = $1 
       ORDER BY priority_level ASC, visit_date ASC, order_index ASC`,
      [trip_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch destinations error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Add destination to a specific trip (enhanced)
app.post("/trips/:tripId/destinations", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tripId } = req.params;
    const {
      name,
      description,
      image_url,
      order_index,
      destination_type,
      address,
      visit_date,
      visit_time,
      price_range,
      priority_level = 3
    } = req.body;

    const result = await client.query(
      `INSERT INTO destinations (
        trip_id, name, description, image_url, order_index,
        destination_type, address, visit_date, visit_time, price_range, priority_level
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [tripId, name, description, image_url, order_index, destination_type, address, visit_date, visit_time, price_range, priority_level]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Add destination to trip error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Update a destination (enhanced)
app.put("/destinations/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      name,
      description,
      image_url,
      order_index,
      destination_type,
      address,
      visit_date,
      visit_time,
      price_range,
      priority_level,
      is_completed
    } = req.body;

    await client.query(
      `UPDATE destinations
       SET name = $1, description = $2, image_url = $3, order_index = $4,
           destination_type = COALESCE($5, destination_type),
           address = COALESCE($6, address),
           visit_date = COALESCE($7, visit_date),
           visit_time = COALESCE($8, visit_time),
           price_range = COALESCE($9, price_range),
           priority_level = COALESCE($10, priority_level),
           is_completed = COALESCE($11, is_completed)
       WHERE id = $12`,
      [name, description, image_url, order_index, destination_type, address, visit_date, visit_time, price_range, priority_level, is_completed, req.params.id]
    );

    res.json({ message: "Destination updated successfully" });
  } catch (err) {
    console.error("Update destination error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Toggle destination completion
app.patch("/destinations/:id/complete", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query(
      "UPDATE destinations SET is_completed = NOT is_completed WHERE id = $1 RETURNING is_completed",
      [req.params.id]
    );

    res.json({ is_completed: result.rows[0].is_completed });
  } catch (err) {
    console.error("Toggle destination completion error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Delete a destination
app.delete("/destinations/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM destinations WHERE id = $1", [req.params.id]);
    res.json({ message: "Destination deleted successfully" });
  } catch (err) {
    console.error("Delete destination error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get destinations for a specific trip (enhanced)
app.get("/trips/:id/destinations", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    const result = await client.query(
      `SELECT * FROM destinations 
       WHERE trip_id = $1 
       ORDER BY priority_level ASC, visit_date ASC, order_index ASC`,
      [id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Get destinations for trip error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// === PHOTOS ===

// Get photos for a trip
app.get("/trips/:tripId/photos", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tripId } = req.params;
    const result = await client.query(
      "SELECT * FROM photos WHERE trip_id = $1 ORDER BY uploaded_at DESC",
      [tripId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch photos error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Add a photo to a trip
app.post("/trips/:tripId/photos", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { tripId } = req.params;
    const { image_url, caption, destination_id } = req.body;

    const result = await client.query(
      `INSERT INTO photos (trip_id, image_url, caption, destination_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [tripId, image_url, caption, destination_id || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Add photo error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Delete a photo
app.delete("/photos/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    await client.query("DELETE FROM photos WHERE id = $1", [id]);

    res.json({ message: "Photo deleted successfully" });
  } catch (err) {
    console.error("Delete photo error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// === UTILITY ENDPOINTS ===

// Get trip statistics
app.get("/trips/:id/stats", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;

    const result = await client.query(
      `SELECT 
        COUNT(DISTINCT d.id) as total_destinations,
        COUNT(DISTINCT CASE WHEN d.is_completed THEN d.id END) as completed_destinations,
        COUNT(DISTINCT p.id) as total_photos,
        COUNT(DISTINCT CASE WHEN d.priority_level = 1 THEN d.id END) as must_see_destinations
       FROM trips t
       LEFT JOIN destinations d ON t.id = d.trip_id
       LEFT JOIN photos p ON t.id = p.trip_id
       WHERE t.id = $1`,
      [id]
    );

    const stats = result.rows[0];
    stats.progress_percentage = stats.total_destinations > 0
      ? Math.round((stats.completed_destinations / stats.total_destinations) * 100)
      : 0;

    res.json(stats);
  } catch (err) {
    console.error("Get trip stats error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

// Start server
app.listen(3000, () => {
  console.log("Travel Companion API running on port 3000");
});