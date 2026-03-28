interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="space-y-2">
      {label && <label className="block text-sm font-medium text-gray-300">{label}</label>}
      <input className={`input-base w-full ${className}`} {...props} />
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
