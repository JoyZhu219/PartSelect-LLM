import React, { useState, useEffect, useRef } from "react";
import "./ChatWindow.css";
import { getAIMessage } from "../api/api";
import { marked } from "marked";
import ProductCard from "./ProductCard";
import ActionButtons from "./ActionButtons";

function ChatWindow() {
  const defaultMessage = [{
    role: "assistant",
    content: `
      👋 Hi! I'm your PartSelect assistant. I can help you with:

      • Finding refrigerator and dishwasher parts  
      • Checking part compatibility  
      • Installation instructions  
      • Troubleshooting issues  
      • Order support  

      What can I help you with today?
      `,
    suggestions: [
      "Find parts for my model",
      "My ice maker isn't working",
      "Check part compatibility",
      "Track my order"
    ]
  }];

  const [messages, setMessages] = useState(defaultMessage);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => `session-${Date.now()}`);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Auto-end chat after 5 minutes of inactivity (frontend timer)
  useEffect(() => {
    // skip timer if only greeting message
    if (messages.length <= 1) return;

    // start a 5-minute timer
    const timer = setTimeout(() => {
      setMessages(prev => [
        ...prev,
        { 
          role: "system", 
          content: "⏱️ **Chat session ended** due to 5 minutes of inactivity.\n\nYour conversation has been saved. Feel free to start a new chat anytime!" 
        }
      ]);

      // Reset to greeting message after 3 seconds
      setTimeout(() => {
        setMessages(defaultMessage);
      }, 3000);
    }, 5 * 60 * 1000); // 5 minutes in ms

    // cleanup timer when user sends or receives new messages
    return () => clearTimeout(timer);
  }, [messages]);


  const handleSend = async (messageText = input) => {
    const textToSend = messageText.trim();
    if (textToSend === "") return;

    // Add user message immediately
    const userMessage = { role: "user", content: textToSend };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      // Call backend API
      const response = await getAIMessage(textToSend, sessionId);

      // ✅ Check if backend ended the session due to inactivity
      if (response?.content?.includes("Session ended") || 
          response?.content?.includes("ended due to") ||
          response?.content?.includes("inactivity")) {
        
        // Add system message explaining why session ended
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: "⏱️ **Previous session ended** due to 5 minutes of inactivity.\n\nStarting a fresh conversation...",
          },
        ]);

        // Give user a moment to read, then show fresh greeting
        setTimeout(() => {
          setMessages(defaultMessage);
        }, 2500);
        return;
      }

      // ✅ Add assistant reply to chat
      const assistantMessage = {
        role: "assistant",
        content: response.content,
        products: response.products || [],
        actions: response.actions || [],
        metadata: response.metadata,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I apologize, but I'm having trouble connecting right now. Please try again in a moment.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };


  const handleSuggestionClick = (suggestion) => {
    setInput(suggestion);
    handleSend(suggestion);
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      handleSend();
      e.preventDefault();
    }
  };

  const renderMessage = (message, index) => {
    // ✅ NEW: Handle system messages differently
    if (message.role === 'system') {
      return (
        <div key={index} className="system-message-container">
          <div className="system-message warning">
            <div 
              dangerouslySetInnerHTML={{
                __html: marked(message.content || '')
                  .replace(/<p>|<\/p>/g, "")
              }}
            />
          </div>
        </div>
      );
    }

    return (
      <div key={index} className={`${message.role}-message-container`}>
        <div className={`message ${message.role}-message ${message.error ? 'error-message' : ''}`}>
          {/* Message Content */}
          {message.content && (
            <div 
              className="message-content"
              dangerouslySetInnerHTML={{
                __html: marked(message.content || '')
                  .replace(/<p>|<\/p>/g, "")
                  // ✅ IMPROVED: Better markdown rendering for lists
                  .replace(/<strong>/g, '<strong style="color: #2e6e3e;">')
              }}
            />
          )}

          {/* Product Cards - ✅ IMPROVED: Only show if products exist */}
          {message.products && message.products.length > 0 && (
            <div className="products-container">
              <div className="products-label">Recommended Parts:</div>
              <div className="products-grid">
                {message.products.slice(0, 3).map((product, idx) => (
                  <ProductCard key={idx} product={product} />
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          {message.actions && message.actions.length > 0 && (
            <div className="actions-container">
              {message.actions.map((action, idx) => (
                <ActionButtons 
                  key={idx} 
                  action={action} 
                  onAction={handleSend}
                />
              ))}
            </div>
          )}

          {/* Quick Suggestions */}
          {message.suggestions && message.suggestions.length > 0 && (
            <div className="suggestions-container">
              {message.suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  className="suggestion-chip"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="chat-container">
      <div className="messages-container">
        {messages.map((message, index) => renderMessage(message, index))}
        
        {loading && (
          <div className="assistant-message-container">
            <div className="message assistant-message">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="input-wrapper">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about parts, troubleshooting, or orders..."
            onKeyPress={handleKeyPress}
            disabled={loading}
            className="chat-input"
          />
          <button 
            className={`send-button ${loading ? 'loading' : ''}`}
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
          >
            {loading ? '...' : '➤'}
          </button>
        </div>
        <div className="input-hint">
          Try: "Ice maker not working" or "Part PS11752778 compatibility"
        </div>
      </div>
    </div>
  );
}

export default ChatWindow;