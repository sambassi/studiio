interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'primary';
  className?: string;
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  const variantClass = {
    default: 'bg-gray-800 text-gray-300',
    success: 'bg-green-900/30 text-green-300 border border-green-800',
    warning: 'bg-yellow-900/30 text-yellow-300 border border-yellow-800',
    error: 'bg-red-900/30 text-red-300 border border-red-800',
    primary: 'bg-studiio-primary/20 text-studiio-primary border border-studiio-primary/50',
  }[variant];

  return (
    <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${variantClass} ${className}`}>
      {children}
    </span>
  );
}
