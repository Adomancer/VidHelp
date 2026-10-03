"use client";

import { hostApi } from "@/lib/api";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "@/components/AuthProvider";
import Card from "@/components/Card";
import FormAlert from "@/components/FormAlert";

/** Shows text with its http(s) links clickable, keeping line breaks. */
function Linkified({ text }: { text: string }) {
  return (
    <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
      {text.split(/(https?:\/\/\S+)/g).map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="text-purple-300 underline hover:text-purple-200">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </p>
  );
}

/** Product knowledge of the brands I'm assigned to. */
export default function HostBrandsPage() {
  const { token } = useAuth();
  const brands = useApiData("my-brands", () => hostApi.brands(token));

  return (
    <div className="max-w-lg space-y-5">
      <h1 className="text-xl font-bold text-white">Brand Saya</h1>
      {brands.error && <FormAlert tone="error">{brands.error}</FormAlert>}

      {brands.data?.brands.length === 0 && (
        <Card>
          <p className="text-sm text-gray-400">Kamu belum ditugaskan ke brand mana pun.</p>
        </Card>
      )}

      {brands.data?.brands.map((brand) => (
        <Card key={brand.id} title={brand.is_obs ? `${brand.name} · OBS` : brand.name}>
          {brand.product_knowledge ? (
            <Linkified text={brand.product_knowledge} />
          ) : (
            <p className="text-sm text-gray-400">Belum ada product knowledge. Tanyakan ke operator kamu.</p>
          )}
        </Card>
      ))}
    </div>
  );
}
