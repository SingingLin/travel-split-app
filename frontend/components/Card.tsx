import { HTMLAttributes } from "react";

export default function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 ${className}`}
      {...props}
    />
  );
}
