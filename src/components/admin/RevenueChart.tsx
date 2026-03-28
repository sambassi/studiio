'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

const data = [
  { month: 'Jan', revenue: 2400 },
  { month: 'Fâv', revenue: 3210 },
  { month: 'Mar', revenue: 2290 },
  { month: 'Avr', revenue: 2000 },
  { month: 'Mai', revenue: 2181 },
  { month: 'Jun', revenue: 2500 },
];

const maxRevenue = Math.max(...data.map(d => d.revenue));

export function RevenueChart() {
  return (
    <Card>
      <CardHeader className="border-b border-gray-800">
        <CardTitle>Revenus par mois</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {data.map((item) => (
            <div key={item.month} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{item.month}</span>
                <span className="text-white font-semibold">{item.revenue}€</span>
              </div>
              <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-gradient-to-r from-studiio-primary to-studiio-accent h-full transition-all"
                  style={{ width: `${(item.revenue / maxRevenue) * 100}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  +}
