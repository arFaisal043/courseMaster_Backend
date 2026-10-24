// middleware to authenticate JWT tokens

const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
  if (!token) {
    return res.status(401).json({ message: "Not authorized" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.NotBeforeError
    ) {
      return res.status(401).json({ message: "Not authorized" });
    }
    return next(error);
  }

  if (typeof decoded.id !== "string" || !mongoose.isValidObjectId(decoded.id)) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const user = await User.findById(decoded.id);
    if (!user || user.isBanned) {
      return res.status(401).json({ message: "Not authorized" });
    }
    req.user = { id: String(user._id), role: user.role };
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = authMiddleware;
