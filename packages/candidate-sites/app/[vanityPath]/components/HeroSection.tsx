"use client";

import Image from "next/image";
import Button from "@/app/shared/buttons/Button";

export default function HeroSection({ activeTheme, content }: { activeTheme: any, content: any }) {
  const hasImage = content?.main?.image;
  return (
    <section className={`py-16 ${activeTheme.secondary}`}>
      <div className="max-w-4xl mx-auto px-8 flex-col md:flex-row flex gap-8 justify-between items-stretch md:items-center">
        <div
          className={`grow lg:min-w-96 ${
            !hasImage ? "text-center" : "text-center md:text-left"
          }`}
        >
          <h1 className="font-medium text-[32px] md:text-4xl">
            {content?.main?.title || ""}
          </h1>
          <p className="text-2xl mb-6">{content?.main?.tagline || ""}</p>
          <Button
            href="#contact"
            className={`inline-block !${activeTheme.accent} !${activeTheme.accentText}`}
          >
            Send a Message
          </Button>
        </div>
        {hasImage && (
          <div className="w-full rounded-lg overflow-hidden shrink">
            <Image
              src={content?.main?.image}
              alt="Campaign Hero"
              className="w-full aspect-[2/1] object-contain"
              height={640}
              width={1280}
            />
          </div>
        )}
      </div>
    </section>
  );
}
