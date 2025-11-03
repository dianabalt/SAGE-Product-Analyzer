// web/components/ProductTypeTag.tsx
// Visual tag component to display product type with color coding

import React from 'react';

export type ProductType = 'COSMETIC' | 'SKINCARE' | 'HEALTH_SUPPLEMENT' | 'FOOD' | 'BEAUTY';

interface ProductTypeTagProps {
  productType?: ProductType | string | null;
  customName?: string | null;
  customColor?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Color scheme with pastel colors
const PRODUCT_TYPE_CONFIG: Record<ProductType, { label: string; bgColor: string; textColor: string; iconColor: string }> = {
  COSMETIC: {
    label: 'Cosmetic',
    bgColor: 'bg-pink-100',
    textColor: 'text-pink-700',
    iconColor: '#ec4899' // pink-500
  },
  SKINCARE: {
    label: 'Skincare',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-700',
    iconColor: '#a855f7' // purple-500
  },
  HEALTH_SUPPLEMENT: {
    label: 'Health Supplement',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
    iconColor: '#3b82f6' // blue-500
  },
  FOOD: {
    label: 'Food',
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-700',
    iconColor: '#f97316' // orange-500
  },
  BEAUTY: {
    label: 'Beauty',
    bgColor: 'bg-pink-100',
    textColor: 'text-pink-700',
    iconColor: '#ec4899' // pink-500
  }
};

export default function ProductTypeTag({
  productType,
  customName,
  customColor,
  size = 'md',
  className = ''
}: ProductTypeTagProps) {
  // Don't render if no product type
  if (!productType) return null;

  // Get config for product type (default to COSMETIC if unknown)
  const config = PRODUCT_TYPE_CONFIG[productType as ProductType] || PRODUCT_TYPE_CONFIG.COSMETIC;

  // Use custom values if provided
  const displayName = customName || config.label;
  const bgColorClass = customColor ? '' : config.bgColor;
  const textColorClass = customColor ? '' : config.textColor;
  const iconColor = customColor || config.iconColor;
  const customStyle = customColor ? { backgroundColor: customColor + '33', color: customColor } : {};

  // Size classes
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-sm px-3 py-1 gap-1.5',
    lg: 'text-base px-4 py-1.5 gap-2'
  };

  const iconSizeMap = {
    sm: 12,
    md: 14,
    lg: 16
  };

  const iconSize = iconSizeMap[size];

  return (
    <div
      className={`inline-flex items-center rounded-full font-medium ${bgColorClass} ${textColorClass} ${sizeClasses[size]} ${className}`}
      style={customColor ? customStyle : undefined}
      title={`Product Type: ${displayName}`}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="shrink-0"
      >
        <path
          d="M17.5 6.875L10.625 3.4375C10.4375 3.34375 10.2188 3.28125 10 3.28125C9.78125 3.28125 9.5625 3.34375 9.375 3.4375L2.5 6.875C2.1875 7.03125 2 7.34375 2 7.6875C2 8.03125 2.1875 8.34375 2.5 8.5L9.375 11.9375C9.5625 12.0312 9.78125 12.0938 10 12.0938C10.2188 12.0938 10.4375 12.0312 10.625 11.9375L17.5 8.5C17.8125 8.34375 18 8.03125 18 7.6875C18 7.34375 17.8125 7.03125 17.5 6.875Z"
          fill={iconColor}
        />
        <path
          d="M16.875 10.625L10 13.9688L3.125 10.625C2.8125 10.4688 2.4375 10.5 2.1875 10.7188C1.9375 10.9375 1.84375 11.2812 1.96875 11.5938L2.5 13.125C2.5625 13.2812 2.6875 13.4062 2.84375 13.5L9.375 16.75C9.5625 16.8438 9.78125 16.9062 10 16.9062C10.2188 16.9062 10.4375 16.8438 10.625 16.75L17.1562 13.5C17.3125 13.4062 17.4375 13.2812 17.5 13.125L18.0312 11.5938C18.1562 11.2812 18.0625 10.9375 17.8125 10.7188C17.5625 10.5 17.1875 10.4688 16.875 10.625Z"
          fill={iconColor}
        />
      </svg>
      <span>{displayName}</span>
    </div>
  );
}

// Export helper function for external use
export function getProductTypeConfig(productType: ProductType | string | null) {
  if (!productType) return null;
  return PRODUCT_TYPE_CONFIG[productType as ProductType] || null;
}
