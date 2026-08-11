import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "destructive" | "outline-dashed";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50",
  destructive: "text-rose-600 hover:text-rose-700 text-sm font-medium disabled:opacity-50",
  "outline-dashed":
    "border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-50",
};

export default function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${VARIANT_CLASSES[variant]} ${className}`} {...props} />;
}
