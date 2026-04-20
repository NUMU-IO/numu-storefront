import type { SectionProps } from "@/types";

export default function Hero({ settings }: SectionProps) {
  return (
    <section className="relative min-h-[60vh] flex items-center justify-center bg-gray-900 text-white"
      style={{ backgroundImage: settings.background_image ? `url(${settings.background_image})` : undefined, backgroundSize: "cover", backgroundPosition: "center" }}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 text-center max-w-3xl px-4">
        <h1 className="text-4xl md:text-6xl font-bold mb-4">{settings.headline || "Welcome"}</h1>
        {settings.subtitle && <p className="text-xl mb-8 text-gray-200">{settings.subtitle}</p>}
        {settings.cta_text && (
          <a href={settings.cta_link || "#"} className="inline-block bg-white text-gray-900 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100 transition">
            {settings.cta_text}
          </a>
        )}
      </div>
    </section>
  );
}
