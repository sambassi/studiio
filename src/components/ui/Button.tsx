/**
 * Bouton partagé de l'application.
 *
 * Style épuré : hauteur fine, contour de 0,5 px sur fond transparent pour les
 * actions secondaires, un seul aplat accent discret pour l'action principale.
 * Ni ombre ni dégradé. Les couleurs et le dessin vivent dans les classes
 * `.button-*` de `globals.css` (couche `components`), la géométrie ici — donc
 * un appelant qui passe `px-6`, `h-11` ou une couleur l'emporte toujours.
 *
 * ⚠️ Aucun prop n'a changé : `variant`, `size`, `disabled`, `className` et
 * tous les attributs de `<button>` se comportent comme avant.
 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const variantClass = {
    primary: 'button-primary',
    secondary: 'button-secondary',
    // `ghost` avait son style écrit en dur ici, avec un dessin différent des
    // trois autres. Il suit maintenant la même famille de classes.
    ghost: 'button-ghost',
    accent: 'button-accent',
  }[variant];

  // Trois hauteurs : 28 / 34 / 40 px. `md` est la référence, `sm` sert aux
  // barres d'outils denses, `lg` aux appels à l'action isolés.
  const sizeClass = {
    sm: 'min-h-[28px] px-2.5 text-[12px] gap-1.5',
    md: 'min-h-[34px] px-3.5 text-[13px]',
    lg: 'min-h-[40px] px-5 text-sm',
  }[size];

  return (
    <button className={`${variantClass} ${sizeClass} ${className}`} {...props}>
      {children}
    </button>
  );
}
