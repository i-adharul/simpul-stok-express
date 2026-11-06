// A labelled <select> with its error line, used by the stock popups (P04, P05).
export default function SelectField({ id, label, error, required = true, children, ...props }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label} {required && <span className="text-error">*</span>}
      </label>
      <select id={id} className={`select w-full ${error ? 'select-error' : ''}`} aria-invalid={Boolean(error)} {...props}>
        {children}
      </select>
      {error && (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      )}
    </div>
  )
}
