'use client';

import Link from 'next/link';
import { Bell, User, LogOut } from 'lucide-react';

export function Navbar() {
  return (
    <nav className="fixed top-0 right-0 left-64 h-16 bg-gray-900 border-b border-gray-800 z-40">
      <div className="h-full px-6 flex justify-between items-center">
        <div className="text-gray-400">Dashboard</div>
        <div className="flex items-center gap-4">
          <button className="text-gray-400 hover:text-white transition relative">
            <Bell size={20} />
            <span className="absolute top-0 right-0 w-2 h-2 bg-studiio-accent rounded-full"></span>
          </button>
          <button className="text-gray-400 hover:text-white transition">
            <User size={20} />
          </button>
          <button className="text-gray-400 hover:text-white transition">
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </nav>
  );
}
