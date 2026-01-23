import React from 'react';

/**
 * FGBMFI Official Logo Component
 * Uses the high-fidelity SVG pathing provided in the technical specification.
 * Renders natively in the browser for perfect clarity at any scale.
 */
export const FGBMFILogo = ({ className }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    viewBox="0 0 200 220" 
    className={className}
    fill="none"
  >
    {/* Torch Handle */}
    <path d="M92 75L96 200L104 200L108 75Z" fill="#F5DEB3" stroke="#DAA520" strokeWidth="1"/>
    {/* Globe Outer Ellipse */}
    <ellipse cx="100" cy="130" rx="85" ry="55" fill="none" stroke="#DAA520" strokeWidth="3"/>
    {/* Latitude Grid Lines */}
    <path d="M15 130Q100 185 185 130" fill="none" stroke="#DAA520" strokeWidth="1"/>
    <path d="M15 130Q100 75 185 130" fill="none" stroke="#DAA520" strokeWidth="1"/>
    {/* Longitude Grid Lines */}
    <path d="M100 75Q55 130 100 185" fill="none" stroke="#DAA520" strokeWidth="1"/>
    <path d="M100 75Q145 130 100 185" fill="none" stroke="#DAA520" strokeWidth="1"/>
    {/* Main Logo Text */}
    <text x="15" y="145" fontFamily="serif" fontWeight="900" fontSize="38" fill="#B71C1C" stroke="#fff" strokeWidth="1">FGB</text>
    <text x="112" y="145" fontFamily="sans-serif" fontWeight="900" fontSize="38" fill="#B71C1C" stroke="#fff" strokeWidth="1">MFI</text>
    {/* Torch Flame (Outer) */}
    <path d="M100 5Q75 45 90 75L110 75Q125 45 100 5Z" fill="#FFD700" stroke="#FF8C00" strokeWidth="2"/>
    {/* Torch Flame (Core) */}
    <path d="M100 15Q88 45 95 65L105 65Q112 45 100 15Z" fill="#FF4500"/>
  </svg>
);