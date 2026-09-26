import React from "react";

export default function BlockchainBackgroundAccents() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 select-none">

      {/* 1. Floating Ethereum Diamond Vector (Top Left) */}
      <div className="absolute top-[8%] left-[2%] sm:left-[7%] animate-float-1 opacity-20 md:opacity-35 block">
        <img
          src="/eth.png"
          alt="Ethereum Vector"
          className="w-18 h-18 md:w-20 md:h-20 sm:w-28 sm:h-28 object-contain filter drop-shadow-[0_0_18px_rgba(168,85,247,0.45)] transform -rotate-12 scale-110"
        />
      </div>

      {/* 2. Floating Blockchain Blocks Vector (Bottom Left) */}
      <div className="absolute bottom-[5%] left-[2%] sm:left-[5%] animate-float-3 opacity-15 md:opacity-35 block">
        <img
          src="/blocks.png"
          alt="Blockchain Blocks Vector"
          className="w-20 h-20 md:w-36 md:h-36 sm:w-56 sm:h-56 object-contain filter drop-shadow-[0_0_30px_rgba(217,70,239,0.5)] transform rotate-12 scale-110"
        />
      </div>

      {/* 3. Floating Security Lock Vector (Top Right) */}
      <div className="absolute top-[10%] right-[2%] sm:right-[6%] animate-float-2 opacity-15 md:opacity-40 block">
        <img
          src="/locks.png"
          alt="Crypto Lock Vector"
          className="w-18 h-18 md:w-32 md:h-32 sm:w-48 sm:h-48 object-contain filter drop-shadow-[0_0_25px_rgba(255,255,255,0.5)] transform -rotate-6 scale-110"
        />
      </div>
      
      {/* 4. Floating Small Block Vector (Bottom Right) */}
      <div className="absolute bottom-[12%] right-[4%] sm:right-[9%] animate-float-1 opacity-20 md:opacity-35 block">
        <img
          src="/small_block.png"
          alt="Block Vector"
          className="w-10 h-10 md:w-14 md:h-14 sm:w-24 sm:h-24 object-contain filter drop-shadow-[0_0_18px_rgba(168,85,247,0.45)] transform rotate-6 scale-110"
        />
      </div>

      {/* 5. Floating Secondary Ethereum Vector (Middle Right Ambient) */}
      <div className="absolute top-[48%] right-[2%] animate-float-3 opacity-10 md:opacity-20 hidden sm:block">
        <img
          src="/eth.png"
          alt="ETH Diamond Vector"
          className="w-12 h-12 md:w-24 md:h-24 sm:w-32 sm:h-32 object-contain filter drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] transform rotate-45 scale-110"
        />
      </div>

    </div>
  );
}
