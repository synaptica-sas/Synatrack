import { displayCountry, getCountryFlagUrl } from "../utils/statusLabels";

interface CountryFlagProps {
  country: string | null | undefined;
  showName?: boolean;
  size?: number;
}

export function CountryFlag({ country, showName = true, size = 20 }: CountryFlagProps) {
  const flagUrl = getCountryFlagUrl(country);
  const name = displayCountry(country);
  const height = Math.round(size * 0.75);

  return (
    <span className="country-flag">
      {flagUrl ? (
        <img
          className="country-flag__img"
          src={flagUrl}
          alt={`Bandera de ${name}`}
          width={size}
          height={height}
          loading="lazy"
        />
      ) : (
        // Tamaño calculado a partir de la prop `size`: no puede salir de una clase.
        <span className="country-flag__fallback" style={{ fontSize: `${size * 0.8}px` }} aria-hidden="true">
          🌐
        </span>
      )}
      {showName && <span className="country-flag__name">{name}</span>}
    </span>
  );
}
