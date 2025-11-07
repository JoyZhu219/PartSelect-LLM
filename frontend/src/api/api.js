const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

/**
 * Main chat API function - sends message and receives response with products/actions
 * @param {string} message - User's message
 * @param {string} sessionId - Unique session identifier
 * @returns {Promise<Object>} Response with content, products, and actions
 */
export const getAIMessage = async (userQuery, sessionId = 'default') => {
  try {
    const response = await fetch(`${API_BASE_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: userQuery,
        sessionId,
        userId: getUserId()
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
};

/**
 * Search for products directly
 * @param {string} query - Search query
 * @param {string} applianceType - 'refrigerator' or 'dishwasher'
 * @returns {Promise<Array>} Array of products
 */
export const searchProducts = async (query, applianceType = null) => {
  try {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (applianceType) params.append('type', applianceType);

    const response = await fetch(`${API_BASE_URL}/products/search?${params}`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.products;
  } catch (error) {
    console.error('Product Search Error:', error);
    throw error;
  }
};

/**
 * Check part compatibility with a model
 * @param {string} partNumber - Part number (e.g., PS11752778)
 * @param {string} modelNumber - Model number (e.g., WDT780SAEM1)
 * @returns {Promise<Object>} Compatibility information
 */
export const checkCompatibility = async (partNumber, modelNumber) => {
  try {
    const response = await fetch(`${API_BASE_URL}/compatibility/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ partNumber, modelNumber }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Compatibility Check Error:', error);
    throw error;
  }
};

/**
 * Health check to verify backend is running
 * @returns {Promise<Object>} Health status
 */
export const healthCheck = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Health Check Error:', error);
    throw error;
  }
};

/**
 * Get or create a unique user ID stored in localStorage
 * @returns {string} User ID
 */
function getUserId() {
  let userId = localStorage.getItem('partselect_user_id');
  
  if (!userId) {
    userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('partselect_user_id', userId);
  }
  
  return userId;
}

/**
 * Clear user session data
 */
export const clearSession = () => {
  localStorage.removeItem('partselect_user_id');
};

export default {
  getAIMessage,
  searchProducts,
  checkCompatibility,
  healthCheck,
  clearSession
};
