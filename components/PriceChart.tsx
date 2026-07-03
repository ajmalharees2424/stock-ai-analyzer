"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface PriceChartProps {
  data: { date: string; close: number }[];
}

export default function PriceChart({ data }: PriceChartProps) {
  // Thin out x-axis labels so they don't overlap on a small screen.
  const tickInterval = Math.max(Math.floor(data.length / 6), 1);

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey="date"
            interval={tickInterval}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            width={56}
          />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "#e4e4e7" }}
            formatter={(value) => [`$${Number(value).toFixed(2)}`, "Close"]}
          />
          <Line type="monotone" dataKey="close" stroke="#22c55e" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
