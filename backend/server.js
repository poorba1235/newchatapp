const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const Message = require('./models/Message');
const Subscription = require('./models/Subscription');
const webpush = require('web-push');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["https://newchatapp-front.vercel.app", "http://localhost:3000"],
        methods: ["GET", "POST"]
    },
    transports: ['websocket'] // Vercel works better with websocket-only to avoid polling stickiness issues
});

// Web Push Configuration
const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY || "BLPwSa3QwGfCqAVnotnzby2FGLwogKOXa7oQBnHoy9qO69qCjPmhiRDj-b-z22O1hE-diT6MYg7G3zNHMZ4FjFM",
    privateKey: process.env.VAPID_PRIVATE_KEY || "QPk4MTjyWY_lVl0dZI5xIKhQE-gYgLCxw91XqFCekJ4"
};

webpush.setVapidDetails(
    'mailto:test@test.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

app.use(cors({ origin: "https://newchatapp-front.vercel.app" }));

app.use(express.json());

// MongoDB Connection
const MONGODB_URI = "mongodb+srv://poorna:ipf0DDe6kQnIFA0O@cluster0.70i2pxn.mongodb.net/familychat";

// Enable debug logging
mongoose.set('debug', true);

let isConnected = false;
const connectDB = async () => {
    if (isConnected && mongoose.connection.readyState === 1) return;

    try {
        console.log('[DB] Connecting to MongoDB...');
        const db = await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            bufferCommands: false, // Don't buffer if connection is down
        });
        isConnected = db.connections[0].readyState === 1;
        console.log('[DB] Connected to MongoDB ✅');
    } catch (err) {
        console.error('[DB ERROR] Could not connect to MongoDB:', err.message);
        isConnected = false;
        throw err; // Re-throw so API routes know we failed
    }
};

// Initial connection attempt
connectDB().catch(err => console.error('[DB] Initial connection failed'));

// API Routes
app.get('/api/messages', async (req, res) => {
    const { user1, user2 } = req.query;
    console.log(`[API] GET /api/messages (limit 5) for ${user1} and ${user2}`);
    try {
        await connectDB();
        // Fetch last 5 messages
        const messages = await Message.find({
            $or: [
                { sender: user1, receiver: user2 },
                { sender: user2, receiver: user1 }
            ]
        })
            .sort({ timestamp: -1 }) // Sort by newest first to get the last 5
            .limit(5);

        // Reverse them back to chronological order (oldest first)
        res.json(messages.reverse());
    } catch (error) {
        console.error(`[API ERROR] /api/messages:`, error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

// Primary route for sending messages (HTTP fallback for Socket.io)
app.post('/api/messages', async (req, res) => {
    const { text, sender, receiver, senderName } = req.body;
    console.log(`[API] POST /api/messages from ${sender} to ${receiver}`);

    try {
        await connectDB();
        const newMessage = new Message({
            text,
            sender,
            receiver,
            timestamp: new Date(),
            read: false
        });
        await newMessage.save();

        // Try to emit via socket if anyone is connected (best effort)
        io.to(receiver).emit('message', newMessage);
        io.to(sender).emit('message', newMessage);

        // Trigger Web Push (Highly reliable via HTTP)
        try {
            const subDoc = await Subscription.findOne({ userId: receiver });
            if (subDoc) {
                const payload = JSON.stringify({
                    title: `💬 New message from ${senderName || 'Family Chat'}`,
                    body: text,
                    icon: '/logo192.png',
                    badge: '/favicon.ico',
                    data: { senderId: sender }
                });
                await webpush.sendNotification(subDoc.subscription, payload);
            }
        } catch (pushErr) {
            console.error('Error sending push notification:', pushErr);
        }

        res.status(201).json(newMessage);
    } catch (error) {
        console.error(`[API ERROR] POST /api/messages:`, error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.get('/api/unread', async (req, res) => {
    const { userId } = req.query;
    console.log(`[API] GET /api/unread?userId=${userId}`);

    try {
        await connectDB(); // Ensure DB is connected in serverless
        const counts = await Message.aggregate([
            { $match: { receiver: userId, read: false } },
            { $group: { _id: "$sender", count: { $sum: 1 } } }
        ]);
        const response = {};
        counts.forEach(item => {
            response[item._id] = item.count;
        });
        res.json(response);
    } catch (error) {
        console.error(`[API ERROR] /api/unread:`, error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.patch('/api/messages/read', async (req, res) => {
    const { sender, receiver } = req.body;
    console.log(`[API] PATCH /api/messages/read. Sender: ${sender}, Receiver: ${receiver}`);
    try {
        await connectDB();
        await Message.updateMany(
            { sender, receiver, read: false },
            { $set: { read: true } }
        );
        res.json({ success: true });
    } catch (error) {
        console.error(`[API ERROR] /api/messages/read:`, error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

app.post('/api/subscribe', async (req, res) => {
    const { userId, subscription } = req.body;
    console.log(`[API] POST /api/subscribe for user: ${userId}`);
    try {
        await connectDB();
        await Subscription.findOneAndUpdate(
            { userId },
            { subscription },
            { new: true, upsert: true }
        );
        res.status(201).json({ success: true });
    } catch (error) {
        console.error(`[API ERROR] /api/subscribe:`, error);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString(), db: isConnected });
});

// Socket.io
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('join', (userId) => {
        socket.join(userId);
        console.log(`User ${userId} joined room`);
    });

    socket.on('sendMessage', async (data) => {
        const { text, sender, receiver } = data;
        try {
            const newMessage = new Message({
                text,
                sender,
                receiver,
                timestamp: new Date(),
                read: false
            });
            await newMessage.save();

            // Emit to receiver
            io.to(receiver).emit('message', newMessage);
            // Emit to sender for confirmation
            io.to(sender).emit('message', newMessage);

            // Trigger Web Push to receiver
            try {
                const subDoc = await Subscription.findOne({ userId: receiver });
                if (subDoc) {
                    const payload = JSON.stringify({
                        title: `💬 New message from ${data.senderName || 'Family Chat'}`,
                        body: text,
                        icon: '/logo192.png',
                        badge: '/favicon.ico',
                        data: { senderId: sender }
                    });
                    await webpush.sendNotification(subDoc.subscription, payload);
                }
            } catch (pushErr) {
                console.error('Error sending push notification:', pushErr);
            }

        } catch (error) {
            console.error('Error saving message:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
