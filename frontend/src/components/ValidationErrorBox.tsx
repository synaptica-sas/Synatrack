import { parseValidationErrors } from "../utils/validation";

export function ValidationErrorBox({ message }: { message: string }) {
  const items = parseValidationErrors(message);
  if (items.length === 0) return null;

  return (
    <div role="alert" className="notice notice--danger notice--accent">
      <p className="notice__title">
        <span className="notice__badge">!</span>
        Revisa los siguientes campos:
      </p>
      <ul className="notice__list">
        {items.map((item, i) => (
          <li key={i}>{item.replace(/^!\s*/, "")}</li>
        ))}
      </ul>
    </div>
  );
}
