'use client';
import { motion } from 'framer-motion';

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-[#050505]">
      <motion.div initial={false} animate={{ opacity: 1, scale: 1 }} className="text-center">
        <h1 className="text-6xl font-black tracking-tighter mb-6">
          <span className="text-red-600">DAGZ</span><span>FLIX</span>
        </h1>
        <div className="flex items-center justify-center gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2.5 h-2.5 bg-red-600 rounded-full"
              animate={{ scale: [1, 1.4, 1], opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}
