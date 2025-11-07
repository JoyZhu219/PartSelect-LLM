import React from 'react';
import './ProductCard.css';

const ProductCard = ({ product }) => {
  const {
    partNumber,
    name,
    description,
    price,
    inStock,
    imageUrl,
    rating,
    reviews,
    compatibility
  } = product;

  const handleAddToCart = () => {
    window.open(product.productUrl, '_blank');
  };

  const handleViewDetails = () => {
    window.open(product.productUrl, '_blank');
  };

  return (
    <div className="product-card">
      <div className="product-image-container">
        <img 
          src={imageUrl || '/placeholder-part.png'} 
          alt={name}
          className="product-image"
          onError={(e) => {
            e.target.src = '/placeholder-part.png';
          }}
        />
        {!inStock && <div className="out-of-stock-badge">Out of Stock</div>}
      </div>

      <div className="product-info">
        <div className="product-part-number">Part #{partNumber}</div>
        <h4 className="product-name">{name}</h4>
        <p className="product-description">{description}</p>

        {rating && (
          <div className="product-rating">
            <div className="stars">
              {'★'.repeat(Math.floor(rating))}
              {'☆'.repeat(5 - Math.floor(rating))}
            </div>
            <span className="rating-text">
              {rating} ({reviews} reviews)
            </span>
          </div>
        )}

        {compatibility && compatibility.length > 0 && (
          <div className="product-compatibility">
            <strong>Compatible with:</strong> {compatibility.slice(0, 2).join(', ')}
            {compatibility.length > 2 && ` +${compatibility.length - 2} more`}
          </div>
        )}

        <div className="product-price-section">
          <div className="product-price">
            {typeof price === 'number' 
              ? `$${price.toFixed(2)}`
              : price 
                ? `$${parseFloat(price).toFixed(2)}`
                : 'Price unavailable'}
          </div>
          {inStock && <div className="in-stock-badge">✓ In Stock</div>}
        </div>

        <div className="product-actions">
          <button 
            className="btn-primary"
            onClick={handleAddToCart}
            disabled={!inStock}
          >
            {inStock ? 'Add to Cart' : 'Out of Stock'}
          </button>
          <button 
            className="btn-secondary"
            onClick={handleViewDetails}
          >
            View Details
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
