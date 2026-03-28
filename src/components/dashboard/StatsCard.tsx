import { Card } from 'A/components/ui/Card';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  change?: string;
  changePositive?: boolean;
}

export function StatsCard({ icon: Icon, label, value, change, changePositive }: StatsCardProps) {
  return (
    <Card className="hover:border-studiio-primary transition">
      <div className="flex justify-between items-start">
        <div>
          <p className="text-gray-400 text-sm mb-2">{label}</p>
          <p className="text-3xl font-bold text-white mb-2">{value}</p>
          {change && (
            <p className={`text-sm ${changePositive ? 'text-green-400' : 'text-red-400'}`}>
              {changePositive ? '↑' : '↓'} {change}
            </p>
          )}
        </div>
        <Icon className="text-studiio-accent" size={32} />
      </div>
    </Card>
  );
}
