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
        origin: "*",
        methods: ["GET", "POST"]
    }
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
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('Could not connect to MongoDB', err));

// API Routes
app.get('/api/messages', async (req, res) => {
    const { user1, user2 } = req.query;
    try {
        const messages = await Message.find({
            $or: [
                { sender: user1, receiver: user2 },
                { sender: user2, receiver: user1 }
            ]
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/unread', async (req, res) => {
    const { userId } = req.query;
    try {
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
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/messages/read', async (req, res) => {
    const { sender, receiver } = req.body;
    try {
        await Message.updateMany(
            { sender, receiver, read: false },
            { $set: { read: true } }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/subscribe', async (req, res) => {
    const { userId, subscription } = req.body;
    try {
        await Subscription.findOneAndUpdate(
            { userId },
            { subscription },
            { new: true, upsert: true }
        );
        res.status(201).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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
