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
    const { title, description, start_date, end_date, user_id, image_url } = req.body;
    const result = await client.query(
      `INSERT INTO trips (title, description, start_date, end_date, user_id, image_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [title, description, start_date, end_date, user_id, image_url]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Create trip error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get all trips (optionally by user_id)
app.get("/trips", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id } = req.query;
    const result = user_id
      ? await client.query("SELECT * FROM trips WHERE user_id = $1 ORDER BY id DESC", [user_id])
      : await client.query("SELECT * FROM trips ORDER BY id DESC");

    res.json(result.rows);
  } catch (err) {
    console.error("Fetch trips error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get one trip by ID
app.get("/trips/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT * FROM trips WHERE id = $1", [req.params.id]);
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
    const { title, description, start_date, end_date, image_url } = req.body;
    await client.query(
      `UPDATE trips SET title = $1, description = $2, start_date = $3, end_date = $4, image_url = $5
       WHERE id = $6`,
      [title, description, start_date, end_date, image_url, req.params.id]
    );
    res.json({ message: "Trip updated successfully" });
  } catch (err) {
    console.error("Update trip error:", err.message);
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

// Get destinations for a trip
app.get("/destinations", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { trip_id } = req.query;
    const result = await client.query(
      "SELECT * FROM destinations WHERE trip_id = $1 ORDER BY id ASC",
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

// Add destination to a trip
app.post("/destinations", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { trip_id, location_name, notes, image_url } = req.body;
    const result = await client.query(
      `INSERT INTO destinations (trip_id, location_name, notes, image_url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [trip_id, location_name, notes, image_url]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Add destination error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Update a destination
app.put("/destinations/:id", verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const { location_name, notes, image_url } = req.body;
    await client.query(
      `UPDATE destinations
       SET location_name = $1, notes = $2, image_url = $3
       WHERE id = $4`,
      [location_name, notes, image_url, req.params.id]
    );
    res.json({ message: "Destination updated successfully" });
  } catch (err) {
    console.error("Update destination error:", err.message);
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


// Home route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

// Start server
app.listen(3000, () => {
  console.log("Travel Companion API running on port 3000");
});