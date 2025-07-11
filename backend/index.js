// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { Parser } from "json2csv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
app.use(
  cors({
    origin: process.env.FRONTEND_DOMAIN,
  })
);

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Helper to generate grid points within bounding box
function generateGridPoints(northeast, southwest, step = 0.02) {
  const points = [];
  for (let lat = southwest.lat; lat <= northeast.lat; lat += step) {
    for (let lng = southwest.lng; lng <= northeast.lng; lng += step) {
      points.push({ lat, lng });
    }
  }
  return points;
}

app.get("/api/dentists", async (req, res) => {
  const city = req.query.city;
  const format = req.query.format; // optional csv format
  if (!city) return res.status(400).json({ error: "City is required" });

  try {
    const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      city
    )}&key=${GOOGLE_API_KEY}`;
    const geoRes = await fetch(geoUrl);
    const geoData = await geoRes.json();

    if (!geoData || geoData.status !== "OK" || !geoData.results?.length) {
      console.log(
        "Full Geocoding API response:\n",
        JSON.stringify(geoData, null, 2)
      );
      return res
        .status(404)
        .json({ error: "City not found or Geocoding API failed" });
    }

    const result = geoData.results[0];
    const geometry = result.geometry;
    const location = geometry.location;

    let northeast, southwest;

    if (geometry.viewport) {
      northeast = geometry.viewport.northeast;
      southwest = geometry.viewport.southwest;
    } else {
      northeast = { lat: location.lat + 0.05, lng: location.lng + 0.05 };
      southwest = { lat: location.lat - 0.05, lng: location.lng - 0.05 };
    }

    console.log(`Using bounding box for city '${city}':`, {
      northeast,
      southwest,
    });

    const gridPoints = generateGridPoints(northeast, southwest);
    const placeIds = new Set();
    const filteredDentists = [];

    for (const point of gridPoints) {
      const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${point.lat},${point.lng}&radius=1500&type=dentist&key=${GOOGLE_API_KEY}`;
      const nearbyRes = await fetch(nearbyUrl);
      const nearbyData = await nearbyRes.json();
      const places = nearbyData.results || [];

      for (const place of places) {
        if (placeIds.has(place.place_id)) continue;
        placeIds.add(place.place_id);

        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website,user_ratings_total,url&key=${GOOGLE_API_KEY}`;
        const detailsRes = await fetch(detailsUrl);
        const detailData = await detailsRes.json();
        const d = detailData.result;

        if (d && !d.website) {
          filteredDentists.push({
            name: d.name,
            phone: d.formatted_phone_number || "N/A",
            gmLink:
              d.url ||
              `https://www.google.com/maps/place/?q=place_id=${place.place_id}`,
            totalRatings: d.user_ratings_total || 0,
          });
        }
      }

      if (nearbyData.next_page_token) await delay(2000);
    }

    if (format === "csv") {
      const parser = new Parser({
        fields: ["name", "phone", "gmLink", "totalRatings"],
      });
      const csv = parser.parse(filteredDentists);
      res.header("Content-Type", "text/csv");
      res.attachment(`${city.replace(/\s+/g, "_")}_dentists.csv`);
      return res.send(csv);
    }

    res.json(filteredDentists);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// City suggestions (can expand this or fetch from DB)
app.get("/api/cities", (req, res) => {
  const suggestions = [
    "Atlanta, GA",
    "Miami, FL",
    "New York, NY",
    "Dallas, TX",
    "Los Angeles, CA",
    "San Diego, CA",
    "Chicago, IL",
    "Houston, TX",
    "Charlotte, NC",
    "Orlando, FL",
  ];
  res.json(suggestions);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
