import React, { useState } from 'react';
import './ActionButtons.css';

const ActionButtons = ({ action, onAction }) => {
  const [inputValue, setInputValue] = useState('');

  const renderAction = () => {
    switch (action.type) {
      case 'suggestion':
        return (
          <div className="suggestions-group">
            {action.suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                className="suggestion-button"
                onClick={() => onAction(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        );

      case 'button_group':
        return (
          <div className="button-group">
            {action.buttons.map((button, idx) => (
              <button
                key={idx}
                className="action-button"
                onClick={() => handleButtonClick(button.action)}
              >
                {button.label}
              </button>
            ))}
          </div>
        );

      case 'input_prompt':
      const fields = action.fields || (action.field ? [action.field] : []);
      return (
        <div className="input-prompt">
          {fields.length > 0 ? (
            <>
              {fields.map((f, idx) => (
                <input
                  key={f}
                  type="text"
                  placeholder={idx === 0
                    ? (action.placeholder || `Enter ${f}`)
                    : `Enter ${f}`}
                  value={Array.isArray(inputValue) ? (inputValue[idx] || '') : (idx === 0 ? inputValue : '')}
                  onChange={(e) => {
                    if (fields.length === 1) {
                      setInputValue(e.target.value);
                    } else {
                      setInputValue((prev) => {
                        const arr = Array.isArray(prev) ? [...prev] : [];
                        arr[idx] = e.target.value;
                        return arr;
                      });
                    }
                  }}
                  className="prompt-input"
                />
              ))}
              <button
                className="prompt-submit"
                onClick={() => {
                  if (fields.length === 1) {
                    if (inputValue.trim()) onAction(inputValue);
                    setInputValue('');
                  } else {
                    const joined = (inputValue || []).filter(Boolean).join(' ');
                    if (joined.trim()) onAction(joined);
                    setInputValue([]);
                  }
                }}
              >
                Submit
              </button>
            </>
          ) : (
            // fallback: single input
            <>
              <input
                type="text"
                placeholder={action.placeholder || `Enter ${action.field || 'value'}`}
                value={typeof inputValue === 'string' ? inputValue : ''}
                onChange={(e) => setInputValue(e.target.value)}
                className="prompt-input"
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && inputValue.trim()) {
                    onAction(inputValue);
                    setInputValue('');
                  }
                }}
              />
              <button
                className="prompt-submit"
                onClick={() => {
                  if (inputValue.trim()) {
                    onAction(inputValue);
                    setInputValue('');
                  }
                }}
              >
                Submit
              </button>
            </>
          )}
        </div>
      );


      case 'add_to_cart':
        return (
          <div className="cart-action">
            <button
              className="add-to-cart-button"
              onClick={() => window.open(`https://www.partselect.com/${action.partNumber}.htm`, '_blank')}
            >
              🛒 Add Part {action.partNumber} to Cart
            </button>
          </div>
        );

      case 'installation_guide':
        return (
          <div className="installation-action">
            <div className="guide-info">
              <div className="guide-details">
                <span className="guide-time">⏱ {action.estimatedTime}</span>
                <span className="guide-difficulty">📊 {action.difficulty}</span>
              </div>
              {action.tools && (
                <div className="tools-needed">
                  <strong>Tools needed:</strong> {action.tools.join(', ')}
                </div>
              )}
            </div>
            <div className="guide-buttons">
              {action.videoUrl && (
                <button
                  className="guide-button video-button"
                  onClick={() => window.open(action.videoUrl, '_blank')}
                >
                  🎥 Watch Video
                </button>
              )}
              {action.pdfUrl && (
                <button
                  className="guide-button pdf-button"
                  onClick={() => window.open(action.pdfUrl, '_blank')}
                >
                  📄 Download PDF
                </button>
              )}
            </div>
          </div>
        );

      case 'product_cards':
        // Products are rendered separately in ChatWindow
        return null;
      
      case 'conversation_completion':
        return (
          <div className="completion-actions">
            <div className="completion-message">Was this helpful?</div>
            <div className="button-group">
              {action.suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  className="completion-button"
                  onClick={() => {
                    if (suggestion === "End this chat" || suggestion === "Start new chat") {
                      window.location.reload();
                    } else {
                      onAction(suggestion);
                    }
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        );

      case 'next_steps':
        return (
          <div className="next-steps-actions">
            <div className="button-group">
              {action.buttons.map((button, idx) => (
                <button
                  key={idx}
                  className="action-button"
                  onClick={() => {
                    if (button.action === 'new_chat') {
                      if (window.confirm('Start a new conversation? Current chat will be saved.')) {
                        window.location.reload();
                      }
                    } else if (button.action === 'search_part') {
                      onAction('Help me find the right replacement part');
                    } else {
                      onAction(button.label);
                    }
                  }}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const handleButtonClick = (actionType) => {
    switch (actionType) {
      case 'initiate_return':
        onAction('I would like to start a return');
        break;
      case 'show_policy':
        onAction('Show me the return policy details');
        break;
      default:
        onAction(actionType);
    }
  };

  return <div className="action-component">{renderAction()}</div>;
};

export default ActionButtons;
