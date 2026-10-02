import React from 'react';
import { motion } from 'framer-motion';
import './DreamyBackground.css';

const DreamyBackground: React.FC = () => {
  return (
    <div className="dreamy-background">
      <div className="dreamy-overlay"></div>
      <motion.div 
        className="orb orb-1"
        animate={{
          x: [0, 100, -50, 0],
          y: [0, -100, 50, 0],
          scale: [1, 1.2, 0.8, 1]
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
      />
      <motion.div 
        className="orb orb-2"
        animate={{
          x: [0, -120, 80, 0],
          y: [0, 120, -80, 0],
          scale: [1, 1.5, 0.9, 1]
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
      />
      <motion.div 
        className="orb orb-3"
        animate={{
          x: [0, 80, -100, 0],
          y: [0, 80, -50, 0],
          scale: [1, 0.8, 1.3, 1]
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
};

export default DreamyBackground;
