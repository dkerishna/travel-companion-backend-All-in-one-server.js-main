const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();
const admin = require("../firebaseAdmin");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());


// ✅ PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ✅ Middleware to verify Firebase token
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // contains uid, email, etc.

    // 🔄 Upsert user into 'users' table
    const { uid, email, name = null } = decodedToken;
    await pool.query(
      `INSERT INTO users (firebase_uid, email, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
      [uid, email, name]
    );

    next();
  } catch (err) {
    console.error("Token verification failed:", err);
    res.status(401).json({ error: "Unauthorized" });
  }
}

// ✅ Test route
app.get("/", (req, res) => {
  res.send("Travel Companion API is running.");
});


// ✅ Secure Routes — TRIPS

// GET all trips for the logged-in user
app.get("/api/trips", verifyToken, async (req, res) => {
  const uid = req.user.uid;

  try {
    const result = await pool.query(
      "SELECT * FROM trips WHERE user_firebase_uid = $1 ORDER BY created_at DESC",
      [uid]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// POST a new trip (no uid from frontend!)
app.post("/api/trips", verifyToken, async (req, res) => {
  const uid = req.user.uid;
  const { title, country, city, start_date, end_date, notes, image_url } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO trips
      (user_firebase_uid, title, country, city, start_date, end_date, notes, image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [uid, title, country, city, start_date, end_date, notes, image_url]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

app.put("/api/trips/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const uid = req.user.uid;
  const { title, country, city, start_date, end_date, notes, image_url } = req.body;

  try {
    // 🔒 SECURITY FIX: Verify ownership before updating
    const result = await pool.query(
      `UPDATE trips SET
        title = $1,
        country = $2,
        city = $3,
        start_date = $4,
        end_date = $5,
        notes = $6,
        image_url = $7
       WHERE id = $8 AND user_firebase_uid = $9
       RETURNING *`,
      [title, country, city, start_date, end_date, notes, image_url, id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Trip not found or unauthorized" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating trip:", err);
    res.status(500).send("Server error");
  }
});

app.delete("/api/trips/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const uid = req.user.uid;

  try {
    // 🔒 SECURITY FIX: Verify ownership before deleting
    const result = await pool.query(
      `DELETE FROM trips WHERE id = $1 AND user_firebase_uid = $2 RETURNING *`,
      [id, uid]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Trip not found or unauthorized" });
    }

    res.json({ message: "Trip deleted successfully" });
  } catch (err) {
    console.error("Error deleting trip:", err);
    res.status(500).send("Server error");
  }
});


// ✅ Secure Routes — DESTINATIONS

app.post("/api/destinations", verifyToken, async (req, res) => {
  const uid = req.user.uid;
  const { trip_id, name, description, latitude, longitude, image_url, order_index } = req.body;

  try {
    // 🔒 SECURITY FIX: Verify the trip belongs to the user
    const tripCheck = await pool.query(
      "SELECT id FROM trips WHERE id = $1 AND user_firebase_uid = $2",
      [trip_id, uid]
    );

    if (tripCheck.rows.length === 0) {
      return res.status(403).json({ error: "Trip not found or unauthorized" });
    }

    const result = await pool.query(
      `INSERT INTO destinations 
      (trip_id, name, description, latitude, longitude, image_url, order_index)
      VALUES ($1, $2, $3, $4, $5, $6, $7) 
      RETURNING *`,
      [trip_id, name, description, latitude, longitude, image_url, order_index]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Error creating destination:", err);
    res.status(500).send("Server error");
  }
});

app.get("/api/destinations/:trip_id", verifyToken, async (req, res) => {
  const { trip_id } = req.params;
  const uid = req.user.uid;

  try {
    // 🔒 SECURITY FIX: Verify the trip belongs to the user before fetching destinations
    const tripCheck = await pool.query(
      "SELECT id FROM trips WHERE id = $1 AND user_firebase_uid = $2",
      [trip_id, uid]
    );

    if (tripCheck.rows.length === 0) {
      return res.status(403).json({ error: "Trip not found or unauthorized" });
    }

    const result = await pool.query(
      `SELECT * FROM destinations 
       WHERE trip_id = $1 
       ORDER BY order_index ASC, created_at ASC`,
      [trip_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching destinations:", err);
    res.status(500).send("Server error");
  }
});

app.put("/api/destinations/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const uid = req.user.uid;
  const { name, description, latitude, longitude, image_url, order_index } = req.body;

  try {
    // 🔒 SECURITY FIX: Verify the destination belongs to a trip owned by the user
    const ownershipCheck = await pool.query(
      `SELECT d.id FROM destinations d
       JOIN trips t ON d.trip_id = t.id
       WHERE d.id = $1 AND t.user_firebase_uid = $2`,
      [id, uid]
    );

    if (ownershipCheck.rows.length === 0) {
      return res.status(404).json({ error: "Destination not found or unauthorized" });
    }

    const result = await pool.query(
      `UPDATE destinations
       SET name = $1,
           description = $2,
           latitude = $3,
           longitude = $4,
           image_url = $5,
           order_index = $6
       WHERE id = $7
       RETURNING *`,
      [name, description, latitude, longitude, image_url, order_index, id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating destination:", err);
    res.status(500).send("Server error");
  }
});

app.delete("/api/destinations/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const uid = req.user.uid;

  try {
    // 🔒 SECURITY FIX: Verify the destination belongs to a trip owned by the user
    const ownershipCheck = await pool.query(
      `SELECT d.id FROM destinations d
       JOIN trips t ON d.trip_id = t.id
       WHERE d.id = $1 AND t.user_firebase_uid = $2`,
      [id, uid]
    );

    if (ownershipCheck.rows.length === 0) {
      return res.status(404).json({ error: "Destination not found or unauthorized" });
    }

    const result = await pool.query(
      `DELETE FROM destinations WHERE id = $1 RETURNING *`,
      [id]
    );

    res.json({ message: "Destination deleted successfully" });
  } catch (err) {
    console.error("Error deleting destination:", err);
    res.status(500).send("Server error");
  }
});

app.post("/api/users", verifyToken, async (req, res) => {
  const { uid, email, name } = req.user;

  try {
    // Insert or update user
    const result = await pool.query(
      `INSERT INTO users (firebase_uid, email, name) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (firebase_uid) DO UPDATE SET 
       email = EXCLUDED.email, 
       name = EXCLUDED.name
       RETURNING *`,
      [uid, email, name]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error creating/updating user:", err);
    res.status(500).send("Server error");
  }
});

module.exports = app;