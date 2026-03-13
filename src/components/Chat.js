/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const SOCKET_URL = "https://newchatapp-back.vercel.app";
const API_URL = "https://newchatapp-back.vercel.app/api";
const VAPID_PUBLIC_KEY = "BLPwSa3QwGfCqAVnotnzby2FGLwogKOXa7oQBnHoy9qO69qCjPmhiRDj-b-z22O1hE-diT6MYg7G3zNHMZ4FjFM";

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

const USERS = [
  { id: "u1", name: "Putha", avatar: "👨" },
  { id: "u2", name: "Duwa", avatar: "👩" },
  { id: "u3", name: "Keerthi", avatar: "👨" },
  { id: "u4", name: "Priyanka", avatar: "👩" },
];

// Priyanka's ID
const PRIYANKA_ID = "u4";

// Notification sound
const notificationSound = new Audio('./notification.mp3');

export default function Chat({ currentUser }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(false);
  const [unreadCount, setUnreadCount] = useState({});
  const [showSidebar, setShowSidebar] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [toast, setToast] = useState(null);
  const [pushStatus, setPushStatus] = useState('Checking...');

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const socketRef = useRef(null);
  const selectedUserRef = useRef(null);
  const showNotificationRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Update refs when values change
  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);


  const isPriyanka = currentUser.id === PRIYANKA_ID;
  const isMobile = windowWidth <= 768;

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Consolidate Push Notification logic into a single effect to avoid callback dependency hell
  useEffect(() => {
    const userId = currentUser.id;

    const sendSubscriptionToBackend = async (subscription) => {
      try {
        await fetch(`${API_URL}/subscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, subscription })
        });
      } catch (error) {
        console.error('Error sending subscription to backend:', error);
      }
    };

    const subscribeUserToPush = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushStatus('Not Supported');
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
          });
        }

        await sendSubscriptionToBackend(subscription);
        setPushStatus('Subscribed ✅');
      } catch (error) {
        console.error('Failed to subscribe to push', error);
        setPushStatus('Error ❌');
      }
    };

    const setupNotifications = async () => {
      if ("Notification" in window) {
        let permission = Notification.permission;
        if (permission !== "granted" && permission !== "denied") {
          permission = await Notification.requestPermission();
        }

        if (permission === "granted") {
          setNotificationPermission(true);
          subscribeUserToPush();
        }
      }
    };

    setupNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id]);

  // Filter users based on access rules
  const getAvailableUsers = () => {
    if (isPriyanka) {
      return USERS.filter(u => u.id !== currentUser.id);
    } else {
      return USERS.filter(u => u.id === PRIYANKA_ID);
    }
  };

  const availableUsers = getAvailableUsers();

  // Filter users by search term
  const filteredUsers = availableUsers.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Check if user is at bottom of messages
  const handleScroll = useCallback(() => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      const bottomThreshold = 100; // pixels from bottom
      const isUserAtBottom = scrollHeight - scrollTop - clientHeight < bottomThreshold;

      setIsAtBottom(isUserAtBottom);
      setShowScrollButton(!isUserAtBottom && messages.length > 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Scroll to bottom function
  const scrollToBottom = (behavior = "smooth") => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: behavior
      });
    }
  };

  // Auto-scroll only if user was at bottom
  useEffect(() => {
    if (messages.length > 0 && isAtBottom) {
      scrollToBottom("smooth");
    }
  }, [messages, isAtBottom]);

  // Add scroll listener
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleScroll]);

  // Show browser notification
  const showNotification = useCallback((sender, messageText) => {
    if (document.hasFocus() && selectedUser?.id === sender) {
      return;
    }

    // Sound is now handled in the socket listener for better consistency

    if (notificationPermission && "Notification" in window) {
      const senderName = USERS.find(u => u.id === sender)?.name || "Unknown";

      const notification = new Notification(`💬 Message from ${senderName}`, {
        body: messageText,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: 'family-chat',
        renotify: true,
        vibrate: [200, 100, 200]
      });

      notification.onclick = () => {
        window.focus();
        setSelectedUser(USERS.find(u => u.id === sender));
        if (isMobile) {
          setShowSidebar(false);
        }
        notification.close();
      };

      setTimeout(() => notification.close(), 5000);
    }

    // In-app Toast
    const senderName = USERS.find(u => u.id === sender)?.name || "Unknown";
    const senderAvatar = USERS.find(u => u.id === sender)?.avatar || "👤";
    setToast({ name: senderName, text: messageText, avatar: senderAvatar, id: sender });

    // Clear toast after 4 seconds
    setTimeout(() => {
      setToast(null);
    }, 4000);
  }, [notificationPermission, selectedUser, isMobile]);

  useEffect(() => {
    showNotificationRef.current = showNotification;
  }, [showNotification]);

  // Listen for messages via Socket.io
  useEffect(() => {
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket'], // Force websocket to avoid 400 Bad Request on Vercel polling
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    socketRef.current.on('connect', () => {
      console.log('Connected to socket');
      socketRef.current.emit('join', currentUser.id);
    });

    socketRef.current.on('message', (msg) => {
      // Use ref to get latest selectedUser
      const currentSelected = selectedUserRef.current;

      // Check if message belongs to current conversation
      if (currentSelected &&
        ((msg.sender === currentUser.id && msg.receiver === currentSelected.id) ||
          (msg.sender === currentSelected.id && msg.receiver === currentUser.id))) {
        setMessages(prev => {
          // Prevent duplicates
          if (prev.find(m => m._id === msg._id)) return prev;
          return [...prev, { ...msg, timestamp: new Date(msg.timestamp) }];
        });
      }

      // Show notification if it's for the current user
      if (msg.receiver === currentUser.id) {
        // Always play sound for every incoming message
        notificationSound.play().catch(e => console.log("Audio play failed:", e));

        // Show visual notification/toast if not in active chat
        if (!currentSelected || msg.sender !== currentSelected.id) {
          if (showNotificationRef.current) {
            showNotificationRef.current(msg.sender, msg.text);
          }
        }
      }
    });

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [currentUser.id]);

  // Fetch initial messages when user is selected
  useEffect(() => {
    if (!selectedUser) return;

    const fetchMessages = async () => {
      try {
        const res = await fetch(`${API_URL}/messages?user1=${currentUser.id}&user2=${selectedUser.id}`);
        const data = await res.json();
        if (Array.isArray(data)) {
          setMessages(data.map(m => ({ ...m, timestamp: new Date(m.timestamp) })));
        } else {
          console.error("API returned non-array for messages:", data);
        }
      } catch (error) {
        console.error("Error fetching messages:", error);
      }
    };

    fetchMessages();
  }, [selectedUser, currentUser.id]);

  // Track unread messages
  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const res = await fetch(`${API_URL}/unread?userId=${currentUser.id}`);
        const data = await res.json();
        setUnreadCount(data);

        const totalUnread = Object.values(data).reduce((a, b) => a + b, 0);
        document.title = totalUnread > 0 ? `(${totalUnread}) Family Chat` : "Family Chat";
      } catch (error) {
        console.error("Error fetching unread counts:", error);
      }
    };

    fetchUnread();

    // Also update when a new message arrives
    if (socketRef.current) {
      socketRef.current.on('message', (msg) => {
        if (msg.receiver === currentUser.id && (!selectedUser || msg.sender !== selectedUser.id)) {
          fetchUnread();
        }
      });
    }

    const interval = setInterval(fetchUnread, 10000); // Polling as fallback
    return () => clearInterval(interval);
  }, [currentUser.id, selectedUser]);

  // Improved send message with API Fallback for Vercel
  const sendMessage = async () => {
    if (!text.trim() || !selectedUser) return;

    const messageData = {
      text: text.trim(),
      sender: currentUser.id,
      senderName: currentUser.name,
      receiver: selectedUser.id
    };

    const originalText = text;
    setText("");

    try {
      // Use HTTP POST as primary on Vercel for reliability
      const res = await fetch(`${API_URL}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messageData)
      });

      if (res.ok) {
        const newMessage = await res.json();
        // Update local state immediately
        setMessages(prev => [...prev, { ...newMessage, timestamp: new Date(newMessage.timestamp) }]);
        setTimeout(() => scrollToBottom("smooth"), 100);
      } else {
        throw new Error('Failed to send message via API');
      }
    } catch (error) {
      console.error("Error sending message:", error);
      // Fallback to socket if API fails (though on Vercel, socket is less reliable)
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('sendMessage', messageData);
      } else {
        alert("Connection failed. Could not send message.");
        setText(originalText); // Restore text so user doesn't lose it
      }
    }
  };

  // Mark messages as read
  useEffect(() => {
    if (!selectedUser) return;

    const markAsRead = async () => {
      try {
        await fetch(`${API_URL}/messages/read`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: selectedUser.id,
            receiver: currentUser.id
          })
        });
      } catch (error) {
        console.error("Error marking messages as read:", error);
      }
    };

    markAsRead();
  }, [selectedUser, currentUser.id]);

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString();
    }
  };

  // Group messages by date
  const groupedMessages = messages.reduce((groups, message) => {
    const date = formatDate(message.timestamp);
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(message);
    return groups;
  }, {});

  // Improved typing indicator with debounce
  const handleTextChange = (e) => {
    setText(e.target.value);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set typing to true
    setIsTyping(true);

    // Set timeout to set typing to false after 1 second of no typing
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
    }, 1000);
  };

  // Cleanup typing timeout
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('familyChat_user');
    localStorage.removeItem('familyChat_timestamp');
    window.location.reload();
  };

  const handleUserSelect = (user) => {
    setSelectedUser(user);
    if (isMobile) {
      setShowSidebar(false);
    }
    // Reset scroll position when changing users
    setTimeout(() => scrollToBottom("auto"), 100);
  };

  const handleBackToUsers = () => {
    setSelectedUser(null);
    if (isMobile) {
      setShowSidebar(true);
    }
  };

  // Handle enter key with better UX
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Mobile styles
  const mobileStyles = {
    sidebar: {
      width: "100%",
      position: "absolute",
      left: showSidebar ? 0 : "-100%",
      top: 0,
      bottom: 0,
      zIndex: 10,
      transition: "left 0.3s ease-in-out"
    },
    chatArea: {
      width: "100%",
      position: "absolute",
      left: !showSidebar ? 0 : "100%",
      top: 0,
      bottom: 0,
      zIndex: 5,
      transition: "left 0.3s ease-in-out"
    }
  };

  return (
    <div style={{
      position: "relative",
      width: "100%",
      height: "100vh",
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      background: "#f0f2f5",
      overflow: "hidden"
    }}>
      {/* WhatsApp Style Toast */}
      {toast && (
        <div
          onClick={() => {
            const user = USERS.find(u => u.id === toast.id);
            if (user) {
              handleUserSelect(user);
              setToast(null);
            }
          }}
          style={{
            position: "absolute",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "white",
            padding: "12px 20px",
            borderRadius: "50px",
            boxShadow: "0 4px 15px rgba(0,0,0,0.15)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            cursor: "pointer",
            animation: "slideDown 0.4s ease-out",
            border: "1px solid #e0e0e0",
            maxWidth: "90%",
            width: "max-content"
          }}
        >
          <span style={{ fontSize: "24px" }}>{toast.avatar}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: "600", fontSize: "14px" }}>{toast.name}</div>
            <div style={{
              fontSize: "13px",
              color: "#667781",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "200px"
            }}>{toast.text}</div>
          </div>
        </div>
      )}

      {/* Sidebar */}
      <div style={{
        width: isMobile ? "100%" : "320px",
        height: "100%",
        background: "#fff",
        borderRight: "1px solid #e0e0e0",
        display: "flex",
        flexDirection: "column",
        position: isMobile ? "absolute" : "relative",
        ...(isMobile ? mobileStyles.sidebar : {}),
        ...(isMobile ? {} : { flexShrink: 0 })
      }}>
        {/* Sidebar Header with Logout */}
        <div style={{
          padding: isMobile ? "15px" : "20px",
          background: "#075e54",
          color: "#fff"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: isMobile ? "20px" : "24px" }}>
              {USERS.find(u => u.id === currentUser.id)?.avatar}
            </span>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: "0", fontSize: isMobile ? "16px" : "18px" }}>
                {currentUser.name}
              </h3>
              <p style={{ margin: "5px 0 0", fontSize: "11px", opacity: "0.8" }}>
                {isPriyanka ? "Admin" : "Chat with Priyanka"}
              </p>
            </div>
            <button
              onClick={handleLogout}
              style={{
                background: "rgba(255,255,255,0.2)",
                border: "none",
                color: "white",
                padding: isMobile ? "4px 8px" : "5px 10px",
                borderRadius: "5px",
                cursor: "pointer",
                fontSize: isMobile ? "11px" : "12px",
                display: "flex",
                alignItems: "center",
                gap: "3px",
                transition: "background 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.3)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.2)"}
            >
              🚪 {!isMobile && "Logout"}
            </button>
          </div>

          {/* Mobile Search Toggle */}
          {isMobile && (
            <div style={{ marginTop: "10px" }}>
              <button
                onClick={() => setShowSearch(!showSearch)}
                style={{
                  width: "100%",
                  padding: "8px",
                  background: "rgba(255,255,255,0.1)",
                  border: "none",
                  borderRadius: "20px",
                  color: "white",
                  textAlign: "left",
                  fontSize: "14px",
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  cursor: "pointer",
                  transition: "background 0.2s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.2)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.1)"}
              >
                🔍 {showSearch ? "Close search" : "Search members..."}
              </button>
            </div>
          )}

          {/* Push Status Info */}
          <div style={{ marginTop: "10px", color: "white", fontSize: "11px", opacity: 0.8, textAlign: "center" }}>
            Alerts: <span style={{ fontWeight: "bold" }}>{pushStatus}</span>
          </div>
        </div>

        {/* Search Bar - Desktop */}
        {!isMobile && (
          <div style={{ padding: "12px", background: "#f6f6f6" }}>
            <input
              type="text"
              placeholder="Search members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: "100%",
                padding: "10px",
                border: "none",
                borderRadius: "20px",
                outline: "none",
                background: "#fff",
                fontSize: "14px",
                transition: "box-shadow 0.2s"
              }}
              onFocus={(e) => e.target.style.boxShadow = "0 0 0 2px rgba(7,94,84,0.2)"}
              onBlur={(e) => e.target.style.boxShadow = "none"}
            />
          </div>
        )}

        {/* Mobile Search Bar */}
        {isMobile && showSearch && (
          <div style={{ padding: "10px", background: "#f6f6f6" }}>
            <input
              type="text"
              placeholder="Search members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
              style={{
                width: "100%",
                padding: "10px",
                border: "none",
                borderRadius: "20px",
                outline: "none",
                background: "#fff",
                fontSize: "14px"
              }}
            />
          </div>
        )}

        {/* Notification Status */}
        {!notificationPermission && (
          <div style={{
            padding: "10px",
            background: "#fff3cd",
            color: "#856404",
            fontSize: isMobile ? "11px" : "12px",
            textAlign: "center",
            borderBottom: "1px solid #ffeeba"
          }}>
            🔔 Enable notifications
            <button
              onClick={() => Notification.requestPermission()}
              style={{
                marginLeft: "10px",
                background: "#856404",
                color: "white",
                border: "none",
                padding: "2px 8px",
                borderRadius: "3px",
                cursor: "pointer",
                fontSize: "11px",
                transition: "background 0.2s"
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#6d5300"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#856404"}
            >
              Enable
            </button>
          </div>
        )}

        {/* Users List */}
        <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
          {filteredUsers.length > 0 ? (
            filteredUsers.map(u => (
              <div
                key={u.id}
                onClick={() => handleUserSelect(u)}
                style={{
                  padding: isMobile ? "12px 15px" : "15px 20px",
                  cursor: "pointer",
                  background: selectedUser?.id === u.id && !isMobile ? "#f0f2f5" : "#fff",
                  borderBottom: "1px solid #f0f2f5",
                  display: "flex",
                  alignItems: "center",
                  gap: isMobile ? "12px" : "15px",
                  transition: "background 0.2s",
                  position: "relative",
                  ...(selectedUser?.id === u.id && !isMobile ? {
                    borderLeft: "4px solid #075e54"
                  } : {})
                }}
                onMouseEnter={(e) => {
                  if (!isMobile && selectedUser?.id !== u.id) {
                    e.currentTarget.style.background = "#f5f5f5";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isMobile && selectedUser?.id !== u.id) {
                    e.currentTarget.style.background = "#fff";
                  }
                }}
              >
                <span style={{ fontSize: isMobile ? "28px" : "32px" }}>{u.avatar}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: "500",
                    display: "flex",
                    alignItems: "center",
                    gap: "5px",
                    fontSize: isMobile ? "14px" : "16px"
                  }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {u.name}
                    </span>
                    {unreadCount[u.id] > 0 && (
                      <span style={{
                        background: "#25D366",
                        color: "white",
                        borderRadius: "50%",
                        width: "20px",
                        height: "20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        flexShrink: 0,
                        animation: "pulse 1s infinite"
                      }}>
                        {unreadCount[u.id]}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: isMobile ? "11px" : "12px", color: "#667781" }}>
                    {u.id === PRIYANKA_ID ? "Admin" : "Family Member"}
                  </div>
                </div>
                {u.id === PRIYANKA_ID && !isPriyanka && (
                  <span style={{
                    fontSize: isMobile ? "10px" : "11px",
                    color: "#075e54",
                    background: "#e8f5e9",
                    padding: "2px 6px",
                    borderRadius: "12px",
                    whiteSpace: "nowrap"
                  }}>
                    Only
                  </span>
                )}
              </div>
            ))
          ) : (
            <div style={{ padding: "20px", textAlign: "center", color: "#667781" }}>
              No members available
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div style={{
        flex: 1,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#efeae2",
        position: isMobile ? "absolute" : "relative",
        ...(isMobile ? mobileStyles.chatArea : {})
      }}>
        {selectedUser ? (
          <>
            {/* Chat Header with Back Button for Mobile */}
            <div style={{
              padding: isMobile ? "10px 15px" : "15px 20px",
              background: "#f0f2f5",
              borderBottom: "1px solid #e0e0e0",
              display: "flex",
              alignItems: "center",
              gap: isMobile ? "10px" : "15px",
              flexShrink: 0
            }}>
              {isMobile && (
                <button
                  onClick={handleBackToUsers}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "24px",
                    cursor: "pointer",
                    padding: "5px",
                    color: "#075e54",
                    transition: "transform 0.2s"
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.1)"}
                  onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
                >
                  ←
                </button>
              )}
              <span style={{ fontSize: isMobile ? "28px" : "32px" }}>{selectedUser.avatar}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 style={{
                  margin: "0",
                  fontSize: isMobile ? "15px" : "16px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}>
                  {selectedUser.name}
                </h3>
                <p style={{ margin: "3px 0 0", fontSize: isMobile ? "11px" : "12px", color: "#667781" }}>
                  {isTyping ? "typing..." : "Online"}
                </p>
              </div>
            </div>

            {/* Messages Area with Scroll Container */}
            <div
              ref={messagesContainerRef}
              style={{
                flex: 1,
                overflowY: "auto",
                padding: isMobile ? "10px" : "20px",
                background: "#efeae2",
                WebkitOverflowScrolling: "touch",
                position: "relative"
              }}
            >
              {Object.entries(groupedMessages).map(([date, dateMessages]) => (
                <div key={date}>
                  <div style={{
                    textAlign: "center",
                    margin: isMobile ? "15px 0" : "20px 0",
                    fontSize: isMobile ? "11px" : "12px",
                    color: "#667781"
                  }}>
                    <span style={{
                      background: "#e4e6eb",
                      padding: isMobile ? "4px 10px" : "5px 12px",
                      borderRadius: "15px",
                      display: "inline-block"
                    }}>
                      {date}
                    </span>
                  </div>

                  {dateMessages.map((msg, index) => {
                    const isMine = msg.sender === currentUser.id;
                    const otherUser = USERS.find(u => u.id === (isMine ? msg.receiver : msg.sender));

                    return (
                      <div
                        key={msg.id}
                        style={{
                          display: "flex",
                          justifyContent: isMine ? "flex-end" : "flex-start",
                          marginBottom: index === dateMessages.length - 1 ? "5px" : "3px",
                          animation: "fadeIn 0.3s ease-in"
                        }}
                      >
                        <div
                          style={{
                            maxWidth: isMobile ? "80%" : "65%",
                            padding: isMobile ? "6px 10px" : "8px 12px",
                            borderRadius: "12px",
                            background: isMine ? "#dcf8c6" : "#fff",
                            position: "relative",
                            boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                            ...(isMine ? {
                              borderBottomRightRadius: "4px"
                            } : {
                              borderBottomLeftRadius: "4px"
                            }),
                            transition: "transform 0.2s",
                            transform: "scale(1)"
                          }}
                          onMouseEnter={(e) => !isMobile && (e.currentTarget.style.transform = "scale(1.02)")}
                          onMouseLeave={(e) => !isMobile && (e.currentTarget.style.transform = "scale(1)")}
                        >
                          {!isMine && (
                            <strong style={{
                              color: "#075e54",
                              fontSize: isMobile ? "12px" : "13px",
                              display: "block",
                              marginBottom: "2px"
                            }}>
                              {otherUser.name}
                            </strong>
                          )}
                          <p style={{
                            margin: "0",
                            fontSize: isMobile ? "14px" : "14px",
                            wordBreak: "break-word",
                            lineHeight: "1.4"
                          }}>
                            {msg.text}
                          </p>
                          <div style={{
                            fontSize: isMobile ? "10px" : "11px",
                            color: "#667781",
                            textAlign: "right",
                            marginTop: "2px"
                          }}>
                            {formatTime(msg.timestamp)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Scroll to Bottom Button */}
            {showScrollButton && (
              <button
                onClick={() => scrollToBottom("smooth")}
                style={{
                  position: "absolute",
                  bottom: "80px",
                  right: "20px",
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  background: "#075e54",
                  color: "white",
                  border: "none",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "20px",
                  zIndex: 10,
                  transition: "all 0.2s",
                  animation: "fadeIn 0.3s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#128C7E"}
                onMouseLeave={(e) => e.currentTarget.style.background = "#075e54"}
              >
                ↓
              </button>
            )}

            {/* Input Area with improved UX */}
            <div style={{
              padding: isMobile ? "10px" : "15px 20px",
              background: "#f0f2f5",
              display: "flex",
              gap: isMobile ? "8px" : "10px",
              alignItems: "center",
              borderTop: "1px solid #e0e0e0",
              flexShrink: 0
            }}>
              <input
                ref={inputRef}
                style={{
                  flex: 1,
                  padding: isMobile ? "12px 15px" : "12px 15px",
                  border: "none",
                  borderRadius: "25px",
                  outline: "none",
                  fontSize: isMobile ? "15px" : "15px",
                  background: "#fff",
                  transition: "box-shadow 0.2s, transform 0.1s",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
                }}
                type="text"
                value={text}
                placeholder={`Message ${selectedUser.name}...`}
                onChange={handleTextChange}
                onKeyDown={handleKeyDown}
                onFocus={(e) => {
                  e.target.style.boxShadow = "0 0 0 3px rgba(7,94,84,0.2)";
                  // Scroll to bottom when focusing on mobile
                  if (isMobile) {
                    setTimeout(() => scrollToBottom("smooth"), 300);
                  }
                }}
                onBlur={(e) => e.target.style.boxShadow = "0 1px 3px rgba(0,0,0,0.1)"}
              />
              <button
                onClick={sendMessage}
                disabled={!text.trim()}
                style={{
                  width: isMobile ? "45px" : "45px",
                  height: isMobile ? "45px" : "45px",
                  borderRadius: "50%",
                  border: "none",
                  background: text.trim() ? "#075e54" : "#b3b3b3",
                  color: "#fff",
                  fontSize: isMobile ? "20px" : "20px",
                  cursor: text.trim() ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s",
                  flexShrink: 0,
                  transform: text.trim() ? "scale(1)" : "scale(0.95)",
                  boxShadow: text.trim() ? "0 2px 5px rgba(7,94,84,0.3)" : "none"
                }}
                onMouseEnter={(e) => {
                  if (!isMobile && text.trim()) {
                    e.currentTarget.style.background = "#128C7E";
                    e.currentTarget.style.transform = "scale(1.05)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isMobile && text.trim()) {
                    e.currentTarget.style.background = "#075e54";
                    e.currentTarget.style.transform = "scale(1)";
                  }
                }}
              >
                ➤
              </button>
            </div>
          </>
        ) : (
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            color: "#667781",
            background: "#f0f2f5",
            padding: "20px",
            textAlign: "center"
          }}>
            <span style={{ fontSize: isMobile ? "48px" : "64px", marginBottom: "20px" }}>💬</span>
            <h2 style={{
              margin: "0 0 10px",
              fontSize: isMobile ? "20px" : "24px",
              color: "#41525d"
            }}>
              {isPriyanka ? "Welcome, Priyanka!" : "Welcome to Family Chat"}
            </h2>
            <p style={{
              margin: "0",
              fontSize: isMobile ? "13px" : "14px",
              maxWidth: isMobile ? "280px" : "400px"
            }}>
              {isPriyanka
                ? "You have admin access. You can chat with all family members."
                : "Select Priyanka from the sidebar to start chatting."}
            </p>
            {isMobile && !selectedUser && (
              <button
                onClick={() => setShowSidebar(true)}
                style={{
                  marginTop: "20px",
                  padding: "12px 24px",
                  background: "#075e54",
                  color: "white",
                  border: "none",
                  borderRadius: "25px",
                  fontSize: "16px",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#128C7E"}
                onMouseLeave={(e) => e.currentTarget.style.background = "#075e54"}
              >
                Select a member
              </button>
            )}
          </div>
        )}
      </div>

      {/* Add keyframe animations */}
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translate(-50%, -20px);
          }
          to {
            opacity: 1;
            transform: translate(-50%, 0);
          }
        }
        
        @keyframes pulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
          100% {
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}