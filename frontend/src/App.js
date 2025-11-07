import React from "react";
import "./App.css";
import ChatWindow from "./components/ChatWindow";

function App() {
  return (
    <div className="App">
      <div className="app-header">
        <div className="header-content">
          <div className="header-logo">
            <span className="logo-icon">🔧</span>
            <div className="header-title">
              <h1 className="header-main">Instalily Case Study - PartSelect Assistant</h1>
              <p className="header-subtitle">Refrigerator & Dishwasher Parts Expert</p>
            </div>
          </div>
        </div>
      </div>
      <ChatWindow />
    </div>
  );
}

export default App;
