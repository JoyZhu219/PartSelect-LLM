CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1) Parts table
CREATE TABLE parts (
    id SERIAL PRIMARY KEY,
    part_number VARCHAR(50) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10,2),
    in_stock BOOLEAN DEFAULT TRUE,
    image_url TEXT,
    rating NUMERIC(2,1),
    review_count INTEGER,
    category VARCHAR(50),
    appliance_type VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Compatibility table: 1 part -> many appliance models
CREATE TABLE part_compatibility (
    id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    model_number VARCHAR(100) NOT NULL,
    UNIQUE (part_id, model_number)
);

-- 3) Conversations: to store each chat session
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(100),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4) Messages: actual turns inside a conversation
CREATE TABLE messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender VARCHAR(20) NOT NULL CHECK (sender IN ('user', 'assistant', 'system')),
    content TEXT,
    payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Helpful indexes for faster lookups
CREATE INDEX idx_parts_part_number ON parts(part_number);
CREATE INDEX idx_parts_appliance_type ON parts(appliance_type);
CREATE INDEX idx_parts_category ON parts(category);
CREATE INDEX idx_part_compat_model ON part_compatibility(model_number);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

ALTER TABLE conversations
ADD COLUMN status VARCHAR(20) DEFAULT 'active';  -- active | ended

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE parts ADD COLUMN embedding vector(1536);
CREATE INDEX idx_parts_embedding ON parts USING ivfflat (embedding vector_l2_ops);

