require('dotenv').config();
require('./tracing');


const express = require('express');
const cors = require('cors');
const axios = require('axios');
const db = require('./db');
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis').default;
const { callDeepSeek } = require('./deepseek');

const limiter = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args)
  }),
  windowMs: 60 * 1000,  // 1 minute
  max: 30,              // 30 requests per minute per IP
  message: 'Too many requests, please try again later.'
});
const app = express();
app.use(cors({
  origin: ['https://www.partselect.com', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
}));
app.use(express.json());
app.use(limiter);
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'server.log' })
  ]
});

const promBundle = require('express-prom-bundle');
const metricsMiddleware = promBundle({
  includeMethod: true,
  includePath: true,
  includeStatusCode: true,
  promClient: {
    collectDefaultMetrics: {}
  }
});
app.use(metricsMiddleware);


// Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'your-api-key';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

// Redis-based context helpers
async function getUserContext(userId) {
  const data = await redis.get(`context:${userId}`);
  return data ? JSON.parse(data) : {};
}

async function setUserContext(userId, context) {
  await redis.set(`context:${userId}`, JSON.stringify(context), 'EX', 3600); // expires in 1h
}

async function clearUserContext(userId) {
  await redis.del(`context:${userId}`);
}

// Fall back for Redis
async function safeRedisGet(key) {
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    logger.error(`⚠️ Redis unavailable, skipping cache for ${key}`);
    return null;
  }
}

async function safeRedisSet(key, value, ttl = 3600) {
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttl);
  } catch (err) {
    logger.error(`⚠️ Redis unavailable, continuing without cache`);
  }
}

// Retry wrapper for errors
async function retry(fn, retries = 3, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn(); // Try executing the function
    } catch (err) {
      const isLastAttempt = i === retries - 1;
      logger.warn(`⚠️ Retry ${i + 1}/${retries} failed: ${err.message}`);

      if (isLastAttempt) throw err; // Out of retries → propagate error
      await new Promise(r => setTimeout(r, delay)); // Wait before retrying
    }
  }
}

// Helper to understand conversation flow
function getConversationContext(history) {
  if (history.length === 0) return { stage: 'initial', topic: null };
  
  const recentMessages = history.slice(-5);
  const lastAssistant = recentMessages.slice().reverse().find(h => h.role === 'assistant');
  
  if (!lastAssistant) return { stage: 'initial', topic: null };
  
  const content = lastAssistant.content.toLowerCase();
  
  // Detect what we were just talking about
  let topic = null;
  let stage = 'ongoing';
  
  if (content.includes('step') || content.includes('troubleshoot')) {
    topic = 'troubleshooting';
    stage = 'diagnostic_given';
  } else if (content.includes('compatible') || content.includes('model')) {
    topic = 'compatibility';
  } else if (content.includes('install')) {
    topic = 'installation';
  } else if (content.includes('part') && content.includes('$')) {
    topic = 'product_recommendation';
  }
  
  return { stage, topic };
}


// Agent System: Define specialized agents
class AgentOrchestrator {
  constructor() {
    this.agents = {
      intent: new IntentClassificationAgent(),
      product: new ProductSearchAgent(),
      compatibility: new CompatibilityAgent(),
      troubleshooting: new TroubleshootingAgent(),
      installation: new InstallationAgent(),
      order: new OrderSupportAgent()
    };
  }

  async processQuery(userId, query, history) {
    // Step 1: Classify intent WITH conversation history
    const intent = await this.agents.intent.classify(query, history);
    
    logger.info(`🎯 Intent: ${intent.primary} (${intent.confidence})`);
    
    // Step 2: Route to appropriate agent(s)
    const response = await this.routeToAgents(intent, query, userId, history);
    
    // Step 3: Format response for frontend
    return this.formatResponse(response, intent);
  }

  async routeToAgents(intent, query, userId, history) {
    const context = await getUserContext(userId);
    const flowContext = getConversationContext(history);
    
    // Handle follow-up questions intelligently
    if (intent.entities?.isFollowUp && flowContext.topic === 'troubleshooting') {
      logger.info('↩️ Follow-up question after troubleshooting');
      return await this.handleGeneralQuery(query, history);
    }
    
    // Handle compatibility flow continuation
    if (context.expecting === 'model_number_for_compat') {
      logger.info('↩️ Continuing compatibility flow');
      intent.primary = 'compatibility_check';
      query = `${context.lastPart || ''} ${query}`.trim();
      context.expecting = null;
      await setUserContext(userId, context);
    }
    
    let response;
    
    switch (intent.primary) {
      case 'product_search':
        response = await this.agents.product.search(query, context, history);
        break;
      
      case 'compatibility_check':
        response = await this.agents.compatibility.check(query, context, history, userId);
        break;
      
      case 'troubleshooting':
        response = await this.agents.troubleshooting.diagnose(query, context, history);
        break;
      
      case 'installation_help':
        response = await this.agents.installation.guide(query, context, history);
        break;
      
      case 'order_support':
        response = await this.agents.order.assist(query, context, history);
        break;
      
      case 'general_question':
        response = await this.handleGeneralQuery(query, history);
        break;
      
      default:
        response = await this.handleOutOfScope(query);
        break;
    }

    await setUserContext(userId, { ...context, lastIntent: intent.primary, lastTopic: flowContext.topic });
    return response;
  }

  formatResponse(agentResponse, intent) {
    const response = {
      message: agentResponse.message,
      products: agentResponse.products || [],
      actions: agentResponse.actions || [],
      metadata: {
        intent: intent.primary,
        confidence: intent.confidence
      }
    };
    
    // Add completion actions if conversation seems complete
    if (this.shouldOfferCompletion(agentResponse)) {
      response.actions.push({
        type: 'conversation_completion',
        suggestions: [
          "Find another part",
          "Ask something else",
          "Start new chat"
        ]
      });
    }
    
    return response;
  }

  // Detect if conversation is wrapping up
  shouldOfferCompletion(agentResponse) {
    const message = agentResponse.message?.toLowerCase() || '';
    
    // Don't show completion if there are input prompts (conversation is ongoing)
    const hasInputPrompt = agentResponse.actions?.some(a => 
      a.type === 'input_prompt' || 
      a.type === 'button_group' ||
      a.type === 'next_steps'
    );
    
    if (hasInputPrompt) {
      return false; // Conversation is still active
    }
    
    const completionIndicators = [
      'you\'re welcome',
      'you\'re very welcome',
      'glad i could help',
      'happy to help',
      'let me know if you need',
      'any other questions',
      'anything else',
      'feel free to',
      'good luck with the repair',
      'good luck with',
      'hope this helps',
      'if you run into any other issues',
    ];
    
    return completionIndicators.some(indicator => message.includes(indicator));
  }

  async handleGeneralQuery(query, history) {
    // Build rich context from recent messages
    const conversationContext = history.length > 0
      ? history.slice(-5).map(h => `${h.role}: ${h.content}`).join('\n\n')
      : '';

    const systemPrompt = `You are a helpful PartSelect assistant. 

  IMPORTANT: This is a follow-up question in an ongoing conversation. Use the conversation history to understand context and provide relevant advice.

  Rules:
  1. If they're asking about hiring a handyman/professional after troubleshooting advice, give honest practical advice
  2. If they're asking "what about X" or "should I Y", refer to what was just discussed
  3. Keep responses conversational and brief (2-4 sentences)
  4. Don't repeat information already given
  5. Focus on answering their specific question

  Previous conversation:
  ${conversationContext}

  Current question: "${query}"

  Provide a helpful, contextual answer based on the conversation flow.`;

    const response = await callWithBreaker(query, history, {
      systemPrompt,
      temperature: 0.7,
      maxTokens: 200
    });
    
    return { message: response };
  }
}

// Intent Classification Agent
class IntentClassificationAgent {
  async classify(query, history) {
    // Handle simple responses first
    const simpleResponses = {
      affirmative: /^(yes|yeah|yep|sure|ok|okay|should i|do i need|what about)/i,
      questioning: /^(should|would|do i|can i|is it|what if)/i,
    };

    // If it's a follow-up question, infer from context
    if (simpleResponses.questioning.test(query.trim())) {
      const lastAssistant = history.slice().reverse().find(h => h.role === 'assistant');
      if (lastAssistant && lastAssistant.content) {
        const content = lastAssistant.content.toLowerCase();
        
        // If we just gave troubleshooting advice
        if (content.includes('step') || content.includes('troubleshoot')) {
          logger.info('🎯 Follow-up question after troubleshooting');
          return { 
            primary: 'general_question', 
            confidence: 0.85,
            entities: { isFollowUp: true, context: 'troubleshooting' }
          };
        }
      }
    }

    // Build richer conversation context (last 5 messages)
    const conversationContext = history.length > 0 
      ? `\n\nRecent conversation (for context):\n${history.slice(-5).map(h => `${h.role}: ${h.content.substring(0, 150)}`).join('\n')}`
      : '';
    
    const prompt = `Analyze this customer query and classify intent.

Customer Query: "${query}"${conversationContext}

CONTEXT AWARENESS RULES:
1. If the query is a follow-up question (starts with "should", "would", "can", "what about"), analyze the conversation to understand what they're asking about
2. If they're asking for advice after receiving troubleshooting steps, classify as general_question (not a new troubleshooting request)
3. Look at the FULL conversation context, not just the current message
4. If unsure, favor the most recent topic rather than assuming a new intent

Possible Intents:
- product_search: Looking for specific parts
- compatibility_check: Checking if a part works
- troubleshooting: Reporting a NEW problem (not follow-up questions)
- installation_help: How to install
- order_support: Orders, shipping, returns
- general_question: Follow-up questions, advice, clarifications about current topic
- out_of_scope: Not related to appliance parts

Respond with valid JSON only: { "primary": "intent_name", "confidence": 0.95, "entities": {...} }`;

    const response = await callWithBreaker(prompt, [], {
      temperature: 0.3,
      responseFormat: 'json'
    });

    try {
      return JSON.parse(response);
    } catch (e) {
      logger.error('Intent classification failed:', e);
      return { primary: 'general_question', confidence: 0.5, entities: {} };
    }
  }
}

// Product Search Agent
class ProductSearchAgent {
  async search(query, context, history) {
    try {
      const lastAssistant = history.slice().reverse().find(h => h.role === 'assistant');
      let searchParams;
      
      if (lastAssistant && lastAssistant.content.includes('search for parts')) {
        const modelMatch = lastAssistant.content.match(/WDT\d{3}[A-Z0-9]+|[A-Z]{3}\d{3,7}[A-Z0-9]{3,}/i);
        if (modelMatch) {
          searchParams = {
            keywords: [modelMatch[0], 'parts', 'compatible'],
            appliance_type: 'dishwasher',
            model_number: modelMatch[0]
          };
        } else {
          searchParams = await this.extractSearchParams(query);
        }
      } else {
        searchParams = await this.extractSearchParams(query);
      }
      
      // NEW: If no specific search criteria, ask for model number
      if (!searchParams.model_number && 
          (!searchParams.keywords || searchParams.keywords.length === 0 || 
          searchParams.keywords.join(' ').toLowerCase().includes('find parts'))) {
        return {
          message: "I'd be happy to help you find parts! What's your appliance model number?\n\n(It's usually on a sticker inside the fridge compartment or on the door frame)",
          products: [],
          actions: [{
            type: 'input_prompt',
            field: 'model_number',
            placeholder: 'Enter model number (e.g. WDT780SAEM1)'
          }]
        };
      }
      
      const products = await this.searchProductDatabase(searchParams);
      
      // If no products found, use AI to provide helpful info
      if (products.length === 0) {
        const aiSuggestion = await this.getAISuggestion(query, searchParams, history);
        return {
          message: aiSuggestion,
          products: [],
          actions: []
        };
      }
      
      const message = products.length > 0 
        ? `I found ${products.length} compatible parts for your ${searchParams.model_number || 'appliance'}. Take a look below!`
        : await this.generateSearchResponse(query, products, searchParams);
      
      return {
        message,
        products,
        actions: [{
          type: 'product_cards',
          products: products.slice(0, 5)
        }]
      };
    } catch (error) {
      logger.error('ProductSearchAgent.search error:', error);
      return {
        message: "I'm having trouble right now. Could you tell me more about what part you're looking for?",
        products: [],
        actions: []
      };
    }
  }

  // Get AI suggestion when no products found
  async getAISuggestion(query, searchParams, history) {
    const conversationContext = history.length > 0
      ? history.slice(-3).map(h => `${h.role}: ${h.content}`).join('\n')
      : '';

    const prompt = `A customer is looking for appliance parts but we don't have specific products available right now.

  Customer query: "${query}"
  ${searchParams.model_number ? `Model number: ${searchParams.model_number}` : ''}
  ${conversationContext ? `\nRecent conversation:\n${conversationContext}` : ''}

  Provide a helpful response that:
  1. Acknowledges what they're looking for
  2. Suggests common parts that typically fit this model/need (use your knowledge)
  3. Offers to help them troubleshoot or find the right part

  Keep it conversational and helpful (3-4 sentences). DO NOT mention "database" or "our inventory".`;

    try {
      const response = await callWithBreaker(prompt, history, {
        temperature: 0.7,
        maxTokens: 200,
        systemPrompt: SYSTEM_PROMPTS.default
      });
      return response;
    } catch (error) {
      logger.error('getAISuggestion failed:', error);
      return `I'd be happy to help you find parts for your ${searchParams.model_number || 'appliance'}. Could you tell me more about what you're looking for? For example, what issue are you experiencing or what part needs replacement?`;
    }
  }

  async extractSearchParams(query) {
    // Normalize text
    const cleaned = query.trim();
    const modelMatch = cleaned.match(/[A-Z]{3}\d{3,7}[A-Z0-9]{2,}/i);  // WDT780SAEM1 etc.
    const partMatch = cleaned.match(/\bPS\d{6,8}\b/i);

    // Local quick-parse logic first
    if (modelMatch || partMatch) {
      const result = {
        part_number: partMatch ? partMatch[0].toUpperCase() : null,
        model_number: modelMatch ? modelMatch[0].toUpperCase() : null,
        keywords: cleaned
          .split(/\s+/)
          .filter(w => !w.match(/[A-Z]{3}\d{3,7}[A-Z0-9]{2,}/i) && !w.match(/\bPS\d{6,8}\b/i)),
        appliance_type: null,
        category: null,
      };

      // If user only typed “WDT780SAEM1” or similar, treat it as model search
      if (result.model_number && result.keywords.length === 0) {
        result.keywords.push(result.model_number);
      }

      return result;
    }

    // Otherwise, call AI to interpret natural language (fallback)
    const prompt = `
  Extract appliance search intent from this sentence:

  "${query}"

  Return JSON with:
  {
    "part_number": "string or null",
    "model_number": "string or null",
    "keywords": ["keywords..."],
    "appliance_type": "refrigerator or dishwasher or null",
    "category": "category name or null"
  }

  If the user only says something general like "I need a shelf bin", 
  guess reasonable keywords but don't fabricate a model number.`;

    try {
      const response = await callWithBreaker(prompt, [], {
        temperature: 0.5,           // a bit more creative
        responseFormat: 'json',
        maxTokens: 150,
        systemPrompt: `You are a friendly appliance parts assistant extracting useful search info.`
      });

      return JSON.parse(response);
    } catch (err) {
      logger.warn('extractSearchParams fallback used:', err.message);
      return { keywords: cleaned.split(/\s+/), appliance_type: null, category: null };
    }
  }


  async searchProductDatabase(params) {
    try {
      // Build a cache key based on query parameters
      const cacheKey = `product:${params.part_number || params.keywords?.join('-') || 'unknown'}`;

      // Try Redis cache first
      const cached = await safeRedisGet(cacheKey);
      if (cached) {
        logger.info(`⚡ Redis cache hit for ${cacheKey}`);
        return JSON.parse(cached);
      }

      logger.info(`🧭 Redis cache miss for ${cacheKey}`);

      let products = [];

      // Direct part number search
      if (params.part_number) {
        const result = await retry(() => db.query(
          `SELECT * FROM parts WHERE part_number ILIKE $1`,
          [params.part_number]
        ));
        if (result.rows.length > 0) {
          products = this.formatProducts(result.rows);
        }
      }

      // Vector/keyword search if no part number match
      if (products.length === 0 && params.keywords && params.keywords.length > 0) {
        const embedRes = await retry(() => axios.post(
          'https://api.openai.com/v1/embeddings',
          {
            model: 'text-embedding-3-small',
            input: params.keywords.join(' ')
          },
          { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
        ));

        const queryEmbedding = embedRes.data.data[0].embedding;
        const vectorLiteral = '[' + queryEmbedding.join(',') + ']';

        const vectorResults = await db.query(
          `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
          FROM parts
          WHERE embedding IS NOT NULL
          ORDER BY embedding <-> $1::vector
          LIMIT 5`,
          [vectorLiteral]
        );

        products = this.formatProducts(vectorResults.rows);
      }

      // Cache result for 24 hours (86400 seconds)
      await safeRedisSet(cacheKey, products, 86400);

      return products;
    } catch (err) {
      logger.error('Product search error:', err);
      return [];
    }
  }

  formatProducts(rows) {
    return rows.map(p => ({
      partNumber: p.part_number,
      name: p.name,
      description: p.description,
      price: parseFloat(p.price || 0),
      inStock: p.in_stock ?? true,
      imageUrl: p.image_url || '/placeholder-part.png',
      productUrl: `https://www.partselect.com/${p.part_number}.htm`,
      rating: p.rating || 4.3,
      reviews: p.review_count || 19,
      compatibility: []
    }));
  }

  async generateSearchResponse(query, products, params) {
    if (products.length === 0) {
      return "I don't have specific product listings for that at the moment, but I can help you find the right parts. Could you tell me more about what you need? For example:\n\n• What's the issue you're experiencing?\n• What part are you looking to replace?\n• Do you have your appliance model number?";
    }

    const prompt = `Generate a helpful response for a customer searching for parts.

  Query: "${query}"
  Found ${products.length} products.

  Create a brief, friendly message (2-3 sentences) that:
  1. Confirms what they're looking for
  2. Mentions how many results were found
  3. Invites them to view the products

  DO NOT mention "database" or "checking database". Be conversational.`;

    try {
      const response = await callWithBreaker(prompt, [], { 
        temperature: 0.7, 
        maxTokens: 150
      });
      return response;
    } catch (error) {
      logger.error('generateSearchResponse failed:', error.message);
      return `I found ${products.length} compatible parts for you. Take a look at the options below!`;
    }
  }
}
// Compatibility Agent
class CompatibilityAgent {
  async check(query, context, history, userId) {
    
    // Extract from current query
    const entities = await this.extractEntities(query);
    let { partNumber, modelNumber } = entities;

    logger.info(`🔍 Current query entities:`, { partNumber, modelNumber });

    // Check history for missing pieces
    if (!partNumber || !modelNumber) {
      const historyEntities = await this.extractFromHistory(history);
      logger.info(`📜 History entities:`, historyEntities);
      
      partNumber = partNumber || historyEntities.partNumber;
      modelNumber = modelNumber || historyEntities.modelNumber;
    }
    
    // Also check saved context from previous turn
    const savedContext = await getUserContext(userId);

    if (!partNumber && savedContext.lastPart) {
      partNumber = savedContext.lastPart;
      logger.info(`💾 Retrieved part from context: ${partNumber}`);
    }
    if (!modelNumber && savedContext.lastModel) {
      modelNumber = savedContext.lastModel;
      logger.info(`💾 Retrieved model from context: ${modelNumber}`);
    }

    logger.info(`🔍 Final combined:`, { partNumber, modelNumber });

    // Case 1: Have part, missing model
    if (partNumber && !modelNumber) {
      logger.info(`✅ Have part ${partNumber}, asking for model`);
      
      await setUserContext(userId, {
        lastPart: partNumber,
        expecting: 'model_number_for_compat',
        lastIntent: 'compatibility_check'
      });

      return {
        message: `Great! I have part number **${partNumber}**. What's your appliance model number?\n\n(e.g., WDT780SAEM1)`,
        actions: [{
          type: 'input_prompt',
          field: 'model_number',
          placeholder: 'Enter model number (e.g. WDT780SAEM1)'
        }]
      };
    }

    // Case 2: Have model, missing part
    if (!partNumber && modelNumber) {
      logger.info(`✅ Have model ${modelNumber}, asking for part`);
      
      await setUserContext(userId, {
        lastPart: partNumber,
        expecting: 'model_number_for_compat',
        lastIntent: 'compatibility_check'
      });

      return {
        message: `Got your model number **${modelNumber}**! Which part number do you want to check?\n\n(e.g., PS11752778)`,
        actions: [{
          type: 'input_prompt',
          field: 'part_number',
          placeholder: 'Enter part number (e.g. PS11752778)'
        }]
      };
    }

    // Case 3: Have neither
    if (!partNumber && !modelNumber) {
      logger.info(`❌ Missing both`);
      
      return {
        message: "To check compatibility, I need:\n• Part number (e.g., PS11752778)\n• Appliance model number (e.g., WDT780SAEM1)\n\nPlease provide one or both:",
        actions: [{
          type: 'input_prompt',
          field: 'part_and_model',
          placeholder: 'Enter part number and model'
        }]
      };
    }

    // Case 4: Have both! Check compatibility
    logger.info(`✅ Checking compatibility: ${partNumber} with ${modelNumber}`);
    
    // Clear context since we're done
    await setUserContext(userId, {});

    const compatible = await this.checkCompatibility(partNumber, modelNumber);
    
    const message = compatible.isCompatible
      ? `✓ **Yes!** Part **${partNumber}** is compatible with **${modelNumber}**.\n\n${compatible.details}`
      : `✗ Unfortunately, part **${partNumber}** is not compatible with **${modelNumber}**.\n\n${compatible.alternativeSuggestion || 'Try searching for parts specifically for your model.'}`;

    return {
      message,
      products: compatible.alternativeParts || [],
      actions: compatible.isCompatible ? [{
        type: 'add_to_cart',
        partNumber: partNumber
      }] : []
    };
  }

  async extractEntities(query) {
    // More flexible regex patterns
    // Part number: PS followed by 8 digits, OR just 8 digits (with word boundaries or after comma/space)
    const partMatch = query.match(/\b(PS\d{8})\b|\b(\d{8})\b/i);
    
    // Model number: More flexible pattern
    // Pattern: 3 letters + 3-7 digits + 3+ alphanumeric (e.g., WDT780SAEM1, ABC123456XXX)
    // Handles models with varying digit lengths
    const modelMatch = query.match(/[A-Z]{3}\d{3,7}[A-Z0-9]{3,}/i);
    
    const extractedPart = partMatch ? (partMatch[1] || partMatch[2]).toUpperCase() : null;
    const extractedModel = modelMatch ? modelMatch[0].toUpperCase() : null;
    
    logger.info(`🔍 Extracted from "${query}":`, { 
      part: extractedPart, 
      model: extractedModel 
    });
    
    return {
      partNumber: extractedPart,
      modelNumber: extractedModel
    };
  }

  async extractFromHistory(history) {
    const recent = history.slice(-3).map(h => h.content).join(' ');
    
    // Use same flexible patterns as extractEntities
    const partMatch = recent.match(/\b(PS\d{8})\b|\b(\d{8})\b/i);
    // Model: 3 letters + 3-7 digits + 3+ alphanumeric
    const modelMatch = recent.match(/[A-Z]{3}\d{3,7}[A-Z0-9]{3,}/i);
    
    const extractedPart = partMatch ? (partMatch[1] || partMatch[2]).toUpperCase() : null;
    const extractedModel = modelMatch ? modelMatch[0].toUpperCase() : null;
    
    logger.info(`📜 Extracted from history:`, { 
      part: extractedPart, 
      model: extractedModel 
    });
    
    return {
      partNumber: extractedPart,
      modelNumber: extractedModel
    };
  }

  async checkCompatibility(partNumber, modelNumber) {
    try {
      const cacheKey = `compat:${partNumber}:${modelNumber}`;

      // Check Redis first
      const cached = await safeRedisGet(cacheKey);
      if (cached) {
        logger.info(`⚡ Redis cache hit for compatibility ${partNumber}-${modelNumber}`);
        return JSON.parse(cached);
      }

      logger.info(`🧭 Redis cache miss for compatibility ${partNumber}-${modelNumber}`);

      // Normal DB lookups
      const partResult = await db.query(
        `SELECT id, name FROM parts WHERE part_number ILIKE $1`,
        [partNumber]
      );

      if (partResult.rows.length === 0) {
        const result =  { 
          isCompatible: false, 
          details: `Part ${partNumber} not found in our database.`,
          alternativeSuggestion: 'Double-check the part number or try searching by part name.'
        };
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400);
        return result;
      }

      const partId = partResult.rows[0].id;
      const partName = partResult.rows[0].name;

      const compat = await db.query(
        `SELECT 1 FROM part_compatibility WHERE part_id = $1 AND model_number ILIKE $2`,
        [partId, modelNumber]
      );

      const isCompatible = compat.rows.length > 0;

      const result =  {
        isCompatible,
        details: isCompatible
          ? `This ${partName} is designed for your ${modelNumber} model.`
          : `The ${partName} is not listed as compatible with model ${modelNumber}.`,
        alternativeSuggestion: !isCompatible
          ? `Would you like me to search for parts that fit your ${modelNumber}?`
          : null,
      };
      await safeRedisSet(cacheKey, result, 86400);

      return result;
    } catch (err) {
      logger.error('Compatibility check error:', err);
      return {
        isCompatible: false,
        details: 'Unable to verify compatibility at this time.',
        alternativeSuggestion: 'Please try again or contact support.'
      };
    }
  }
}

// Troubleshooting Agent
function detectUserProgress(query, history) {
  const progressIndicators = {
    completed_check: /checked|tested|tried|looked at|inspected|verified|found|discovered/i,
    found_issue: /broke|broken|damaged|cracked|leaking|not working|failed|bad|worn/i,
  };

  const hasCompletedCheck = progressIndicators.completed_check.test(query);
  const foundIssue = progressIndicators.found_issue.test(query);
  
  const lastAssistant = history.slice().reverse().find(h => h.role === 'assistant');
  const wasGivingSteps = lastAssistant && /Step \d:|Troubleshooting Steps:/i.test(lastAssistant.content);
  
  return {
    shouldSkipToSolution: hasCompletedCheck && foundIssue && wasGivingSteps
  };
}

class TroubleshootingAgent {
  async diagnose(query, context, history) {
    // Check if user found the issue
    const progress = detectUserProgress(query, history);
    
    if (progress.shouldSkipToSolution) {
      logger.info('🎯 User found issue - jumping to solution');
      return await this.provideSolution(query, context, history);
    }
    
    // Your existing code stays exactly the same
    const analysis = await this.analyzeProblem(query, context, history);
    const guide = await this.generateTroubleshootingGuide(analysis);
    
    let suggestedParts = [];
    if (analysis.parts && analysis.parts.length > 0) {
      suggestedParts = await this.findRelevantParts(analysis);
    }
    
    return {
      message: guide,
      products: suggestedParts,
      actions: [{ type: 'troubleshooting_wizard', steps: analysis.steps }]
    };
  }

  async analyzeProblem(query, context, history) {
    const conversationContext = history.length > 0
      ? `\n\nConversation history:\n${history.slice(-3).map(h => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    const prompt = `You are an appliance repair expert. Analyze this problem:

"${query}"${conversationContext}

Provide a diagnosis in the following JSON format:
{
  "likelyCause": "Most likely cause of the issue",
  "steps": ["Step 1: Check...", "Step 2: Test...", "Step 3: Inspect..."],
  "parts": ["part_name1", "part_name2"],
  "difficulty": "easy|medium|hard"
}

Provide 3-5 troubleshooting steps.

IMPORTANT: Only include parts in the "parts" array if the troubleshooting steps are likely to reveal that a part needs replacement. If the issue can be resolved by checking settings, cleaning, or adjusting things, leave "parts" as an empty array.

Examples:
- "Ice maker not working" → parts: ["ice maker assembly", "water inlet valve"] (likely needs replacement)
- "Refrigerator not cooling" → parts: ["compressor", "thermostat"] (likely needs parts)
- "Ice maker making noise" → parts: [] (might just need cleaning or adjustment)
- "Water dispenser slow" → parts: [] (likely just a clogged filter or setting)`;

    const response = await callWithBreaker(prompt, [], {
      temperature: 0.5,
      systemPrompt: SYSTEM_PROMPTS.troubleshooting,
      responseFormat: 'json'
    });

    try {
      return JSON.parse(response);
    } catch (e) {
      return { steps: [], likelyCause: 'Unknown', parts: [], difficulty: 'medium' };
    }
  }

  async generateTroubleshootingGuide(analysis) {
    const cause = analysis.likelyCause || 'Unknown';
    const conciseCause = cause.split(/[.?!]/)[0].trim();

    // More natural, less robotic format
    return `Based on the symptoms, this sounds like ${conciseCause.toLowerCase()}.

  Here's what I recommend checking:

  ${(analysis.steps || []).map((step, i) => `${i + 1}. ${step}`).join('\n')}

  Try these steps and let me know what you find! I'm here if you need help with any of them.`;
  }

  async findRelevantParts(analysis) {
    try {
      const searchText = [
        analysis.likelyCause || '',
        ...(analysis.parts || [])
      ].join(' ');

      if (!searchText.trim()) return [];

      const embedRes = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          model: 'text-embedding-3-small',
          input: searchText
        },
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
      );

      const queryEmbedding = embedRes.data.data[0].embedding;
      const vectorLiteral = '[' + queryEmbedding.join(',') + ']';

      const result = await db.query(
        `SELECT *, 1 - (embedding <=> $1::vector) AS similarity
        FROM parts
        WHERE embedding IS NOT NULL
        ORDER BY embedding <-> $1::vector
        LIMIT 3`,
        [vectorLiteral]
      );

      return result.rows.map(p => ({
        partNumber: p.part_number,
        name: p.name,
        description: p.description,
        price: parseFloat(p.price || 0),
        inStock: p.in_stock ?? true,
        imageUrl: p.image_url || '/placeholder-part.png',
        productUrl: `https://www.partselect.com/${p.part_number}.htm`,
        rating: p.rating || 4.3,
        reviews: p.review_count || 19
      }));
    } catch (err) {
      logger.error('findRelevantParts error:', err.message);
      return [];
    }
  }

  async provideSolution(query, context, history) {
    const conversationContext = history.slice(-3).map(h => `${h.role}: ${h.content}`).join('\n');

    const prompt = `User found the issue. Provide direct solution (under 100 words).

  User: "${query}"
  Recent conversation: ${conversationContext}

  Response format:
  1. Acknowledge their finding (1 sentence)
  2. Recommend the part needed (1-2 sentences)
  3. Next steps (1 sentence)

  DO NOT repeat troubleshooting steps they completed.`;

    const response = await callWithBreaker(prompt, [], {
      temperature: 0.7,
      systemPrompt: SYSTEM_PROMPTS.troubleshooting
    });

    const analysis = await this.analyzeProblem(query, context, history);
    const suggestedParts = analysis.parts?.length > 0 
      ? await this.findRelevantParts(analysis)
      : [];

    return {
      message: response,
      products: suggestedParts,
      actions: [
        ...(suggestedParts.length > 0 ? [{
          type: 'product_cards',
          products: suggestedParts.slice(0, 3)
        }] : []),
        // NEW: Add helpful next steps
        {
          type: 'next_steps',
          buttons: [
            { label: 'Find this part', action: 'search_part' },
            { label: 'Ask another question', action: 'continue' },
            { label: 'Start fresh chat', action: 'new_chat' }
          ]
        }
      ]
    };
  }
}

// Installation Agent
class InstallationAgent {
  async guide(query, context, history) {
    const entities = await this.extractPartInfo(query);
    
    if (!entities.partNumber) {
      return {
        message: "I'd be happy to help with installation! Which part are you installing? Please provide the part number (e.g., PS11752778)."
      };
    }

    const installGuide = await this.getInstallationGuide(entities.partNumber);
    
    return {
      message: installGuide.instructions,
      actions: [{
        type: 'installation_guide',
        videoUrl: installGuide.videoUrl,
        pdfUrl: installGuide.pdfUrl,
        estimatedTime: installGuide.estimatedTime,
        difficulty: installGuide.difficulty,
        tools: installGuide.toolsNeeded
      }]
    };
  }

  async extractPartInfo(query) {
    const partMatch = query.match(/PS\d{8}|\b\d{8}\b/i);
    return {
      partNumber: partMatch ? partMatch[0].toUpperCase() : null
    };
  }

  async getInstallationGuide(partNumber) {
    const prompt = `Create installation instructions for refrigerator/dishwasher part ${partNumber}.

Provide:
1. Brief overview (2-3 sentences)
2. Tools needed
3. Step-by-step instructions (5-7 steps)
4. Safety warnings
5. Estimated time
6. Difficulty level

Keep it clear and concise.`;

    const instructions = await callWithBreaker(prompt, [], {
      systemPrompt: SYSTEM_PROMPTS.installation,
      temperature: 0.5
    });

    return {
      instructions,
      videoUrl: `https://partselect.com/videos/${partNumber}`,
      pdfUrl: `https://partselect.com/guides/${partNumber}.pdf`,
      estimatedTime: '30-45 minutes',
      difficulty: 'Medium',
      toolsNeeded: ['Phillips screwdriver', 'Flathead screwdriver', 'Pliers']
    };
  }
}

// Order Support Agent
class OrderSupportAgent {
  async assist(query, context, history) {
    const orderIntent = await this.classifyOrderIntent(query);
    
    switch(orderIntent) {
      case 'track_order':
        return await this.handleOrderTracking(query);
      case 'return_request':
        return await this.handleReturn(query);
      case 'shipping_info':
        return await this.handleShippingInfo(query);
      default:
        return await this.handleGeneralOrderQuery(query, history);
    }
  }

  async classifyOrderIntent(query) {
    const intents = {
      track: ['track', 'status', 'where is', 'shipped'],
      return: ['return', 'refund', 'send back'],
      shipping: ['shipping', 'delivery', 'how long', 'when will']
    };

    const lowerQuery = query.toLowerCase();
    if (intents.track.some(kw => lowerQuery.includes(kw))) return 'track_order';
    if (intents.return.some(kw => lowerQuery.includes(kw))) return 'return_request';
    if (intents.shipping.some(kw => lowerQuery.includes(kw))) return 'shipping_info';
    return 'general';
  }

  async handleOrderTracking(query) {
    return {
      message: "I can help you track your order! Please provide your order number (e.g., PS123456).",
      actions: [{
        type: 'input_prompt',
        field: 'order_number',
        placeholder: 'Enter order number'
      }]
    };
  }

  async handleReturn(query) {
    return {
      message: "I understand you'd like to return an item. PartSelect offers:\n\n" +
               "• 365-day return policy\n" +
               "• Free return shipping\n" +
               "• Full refund for unused parts\n\n" +
               "Would you like me to start a return request? I'll need your order number.",
      actions: [{
        type: 'button_group',
        buttons: [
          { label: 'Start Return', action: 'initiate_return' },
          { label: 'Return Policy Details', action: 'show_policy' }
        ]
      }]
    };
  }

  async handleShippingInfo(query) {
    return {
      message: "PartSelect offers:\n\n" +
               "📦 **Standard Shipping:** 5-7 business days (FREE over $50)\n" +
               "🚚 **Expedited Shipping:** 2-3 business days\n" +
               "⚡ **Express Shipping:** 1-2 business days\n\n" +
               "Most orders ship within 24 hours!"
    };
  }

  async handleGeneralOrderQuery(query, history) {
    const response = await callWithBreaker(query, history, {
      systemPrompt: SYSTEM_PROMPTS.orderSupport,
      temperature: 0.7
    });
    return { message: response };
  }
}

// === Circuit Breaker for External API ===
let circuitBreakerState = 'CLOSED';
let failureCount = 0;
let lastFailureTime = 0;

const CIRCUIT_BREAKER_THRESHOLD = 3;    // number of failures before opening
const CIRCUIT_BREAKER_RESET_TIME = 30000; // 30 seconds

async function callWithBreaker(userMessage, history = [], options = {}) {
  // Check breaker state
  if (circuitBreakerState === "OPEN") {
    const elapsed = Date.now() - lastFailureTime;
    if (elapsed < CIRCUIT_BREAKER_RESET_TIME) {
      logger.warn("🚫 Circuit breaker OPEN — skipping DeepSeek/OpenAI call");
      throw new Error("AI temporarily unavailable (circuit open)");
    } else {
      circuitBreakerState = "HALF_OPEN";
      logger.info("🧭 Circuit half-open — testing DeepSeek connection");
    }
  }

  try {
    // ✅ Try DeepSeek first
    const result = await callDeepSeek(userMessage, history, options);

    // Reset breaker on success
    failureCount = 0;
    circuitBreakerState = "CLOSED";
    return result;

  } catch (err) {
    logger.warn("⚠️ DeepSeek failed, falling back to OpenAI");

    // Count as failure for breaker
    failureCount++;
    lastFailureTime = Date.now();

    if (failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      circuitBreakerState = "OPEN";
      logger.error("🚨 Circuit breaker TRIPPED (DeepSeek + OpenAI)");
    }

    // 🔁 Try OpenAI fallback
    try {
      const fallback = await callOpenAI(userMessage, history, options);
      failureCount = 0;
      circuitBreakerState = "CLOSED";
      return fallback;
    } catch (openaiErr) {
      logger.error("❌ Both DeepSeek and OpenAI failed:", openaiErr.message);
      throw openaiErr;
    }
  }
}



// AI API Integration
async function callOpenAI(userMessage, history = [], options = {}) {
  const {
    systemPrompt = SYSTEM_PROMPTS.default,
    temperature = 0.7,
    maxTokens = 1000,
    responseFormat = 'text'
  } = options;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-5),
    { role: 'user', content: userMessage }
  ];

  const body = {
    model: OPENAI_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens
  };

  if (responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await axios.post(OPENAI_API_URL, body, {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    return response.data.choices[0].message.content;
  } catch (err) {
    logger.error("OpenAI API error:", err.response?.data || err.message);
    throw new Error("OpenAI call failed");
  }
}



// System Prompts
const SYSTEM_PROMPTS = {
  default: `You are a helpful PartSelect assistant specializing in refrigerator and dishwasher parts.

Be conversational and natural - like a knowledgeable friend helping out, not a robot reading a script.

Guidelines:
- Use conversation history to understand context
- Don't repeat information already discussed
- Answer follow-up questions directly without restating everything
- Be friendly but concise (2-4 sentences for simple questions)
- If giving steps, format them clearly but naturally
- Focus on what the customer needs right now

IMPORTANT: 
- NEVER mention "database", "inventory system", or "checking our database"
- If you don't have specific product listings, use your knowledge to suggest common parts
- Always be helpful even without exact product matches

Stay focused on appliance parts - politely redirect off-topic questions.`,

  troubleshooting: `You are an expert appliance repair technician.

IMPORTANT: Be conversational and context-aware. If this is a follow-up to previous troubleshooting advice, reference what was already discussed.

When diagnosing:
1. Consider the conversation history
2. Don't repeat steps they've already tried
3. Build on previous information
4. Be encouraging and supportive
5. Write naturally, not robotically

Return JSON when requested, but write conversationally otherwise.`,

  installation: `You are an expert appliance repair technician providing installation guidance.

When providing installation instructions:
1. Start with safety warnings
2. List all required tools
3. Provide clear, step-by-step instructions
4. Include tips for common mistakes
5. Mention estimated time and difficulty

Keep instructions concise but complete.`,

  orderSupport: `You are a customer service representative for PartSelect.

Help customers with:
- Order tracking
- Shipping information
- Returns and refunds
- Billing questions
- Account issues

Be empathetic and solution-oriented. Provide clear next steps.`
};

// API Routes
const orchestrator = new AgentOrchestrator();

app.post('/api/chat', async (req, res) => {
  try {
    let { message, userId = 'default' } = req.body;
    
    // Handle different message formats
    if (typeof message === 'object' && message !== null) {
      // Handle { message: "text" } or { content: "text" }
      if (message.message) {
        message = message.message;
      } else if (message.content) {
        message = message.content;
      } else {
        // Try to extract any string value
        const stringValue = Object.values(message).find(v => typeof v === 'string');
        message = stringValue || JSON.stringify(message);
      }
    }
    
    // Convert to string if needed
    if (typeof message !== 'string') {
      message = String(message || '');
    }

    message = message.trim();

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    logger.info(`\n💬 User ${userId}: ${message}`);

    // === Step 1: Get or create conversation ===
    let conversation = await db.query(
      `SELECT * FROM conversations 
       WHERE user_id = $1 
       AND (status = 'active' OR status IS NULL)
       ORDER BY last_activity_at DESC
       LIMIT 1`,
      [userId]
    );

    const now = new Date();
    let convId;

    // === Step 2: Check timeout (5 minutes) ===
    if (
      conversation.rows.length === 0 ||
      (now - new Date(conversation.rows[0].last_activity_at)) / 60000 > 5
    ) {
      if (conversation.rows.length > 0) {
        await db.query(
          `UPDATE conversations SET status = 'ended' WHERE id = $1`,
          [conversation.rows[0].id]
        );
      }

      await clearUserContext(userId);
      logger.info(`🧹 Cleared context for new conversation`);

      const newConv = await db.query(
        `INSERT INTO conversations (user_id, status) 
         VALUES ($1, 'active') RETURNING id`,
        [userId]
      );
      convId = newConv.rows[0].id;
      logger.info(`🆕 New conversation: ${convId}`);
    } else {
      convId = conversation.rows[0].id;
      await db.query(
        `UPDATE conversations SET last_activity_at = NOW() WHERE id = $1`,
        [convId]
      );
      logger.info(`♻️ Continue conversation: ${convId}`);
    }

    // === Step 3: Store user message ===
    await db.query(
      `INSERT INTO messages (conversation_id, sender, content) VALUES ($1, 'user', $2)`,
      [convId, message]
    );

    // === Step 4: LOAD CONVERSATION HISTORY ===
    const historyResult = await db.query(
      `SELECT sender, content 
       FROM messages 
       WHERE conversation_id = $1 
       ORDER BY created_at ASC`,
      [convId]
    );

    const history = historyResult.rows.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));

    logger.info(`📜 History: ${history.length} messages`);

    // === Step 5: Process with history ===
    const response = await orchestrator.processQuery(userId, message, history);

    // === Step 6: Store assistant reply ===
    await db.query(
      `INSERT INTO messages (conversation_id, sender, content, payload) VALUES ($1, 'assistant', $2, $3)`,
      [convId, response.message, JSON.stringify(response.products || [])]
    );

    logger.info(`✅ Response: ${response.message.substring(0, 100)}...`);

    // === Step 7: Send response ===
    res.json({
      role: 'assistant',
      content: response.message,
      products: response.products,
      actions: response.actions,
      metadata: response.metadata,
      conversation_id: convId,
    });
  } catch (error) {
    logger.error('❌ Error:', error);
    res.status(500).json({
      error: 'Server error',
      role: 'assistant',
      content: "I'm having trouble right now. Please try again shortly.",
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Product search
app.get('/api/products/search', async (req, res) => {
  const { q, type } = req.query;

  try {
    const results = await db.query(
      `SELECT * FROM parts
       WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR description ILIKE '%' || $1 || '%' OR part_number ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR appliance_type ILIKE $2)
       ORDER BY rating DESC NULLS LAST
       LIMIT 20`,
      [q || null, type || null]
    );

    res.json({ products: results.rows });
  } catch (err) {
    logger.error('DB search error:', err);
    res.status(500).json({ error: 'Database query failed' });
  }
});

// Compatibility check
app.post('/api/compatibility/check', async (req, res) => {
  const { partNumber, modelNumber } = req.body;
  
  const agent = new CompatibilityAgent();
  const result = await agent.checkCompatibility(partNumber, modelNumber);
  
  res.json(result);
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  logger.info(`🚀 PartSelect Chat API running on port ${PORT}`);
  logger.info(`📡 Health: http://localhost:${PORT}/api/health`);
});

module.exports = app;

// Cleanup idle conversations every 5 minutes
setInterval(async () => {
  try {
    await db.query(`
      UPDATE conversations
      SET status = 'ended'
      WHERE status = 'active'
      AND NOW() - last_activity_at > INTERVAL '5 minutes'
    `);
  } catch (err) {
    logger.error('Cleanup error:', err.message);
  }
}, 5 * 60 * 1000);