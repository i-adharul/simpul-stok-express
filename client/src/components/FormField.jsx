// One labelled input (or textarea) with its error line, shared by the P01 and P02 forms.
export default function FormField({ id, label, required, hint, error, multiline, ...inputProps }) {
  const Tag = multiline ? 'textarea' : 'input'
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label} {required && <span className="text-error">*</span>}
      </label>
      <Tag id={id} className={`${multiline ? 'textarea' : 'input'} w-full ${error ? 'input-error' : ''}`} aria-invalid={Boolean(error)} {...inputProps} />
      {error ? (
        <p role="alert" className="text-sm font-medium text-error">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-base-content/60">{hint}</p>
      )}
    </div>
  )
}
