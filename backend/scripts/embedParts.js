require('dotenv').config();
const axios = require('axios');
const db = require('../db');

(async () => {
  try {
    // 1. fetch all parts without embeddings
    const parts = await db.query(`SELECT id, name, description, category, appliance_type FROM parts WHERE embedding IS NULL`);

    for (const part of parts.rows) {
      const text = `${part.name}. ${part.description || ''}. ${part.category || ''}. ${part.appliance_type || ''}`;
      
      // 2. get embedding from OpenAI
      const response = await axios.post(
        'https://api.openai.com/v1/embeddings',
        {
          model: 'text-embedding-3-small',
          input: text,
        },
        { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }
      );

      const embedding = response.data.data[0].embedding;

      // 3. store embedding in Postgres
      await db.query(
        `UPDATE parts SET embedding = $1::vector WHERE id = $2`,
        ['[' + embedding.join(',') + ']', part.id]
        );
      console.log(`✅ Embedded: ${part.name}`);
    }

    console.log('🎉 All parts embedded successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error embedding parts:', err);
    process.exit(1);
  }
})();
