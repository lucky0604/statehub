import type { AnswerEnvelope } from "@statehub/domain";

/**
 * AI Answer Block — renders the answer envelope from an AI PM query.
 *
 * Server component. Renders conclusion, basis list, risks, and missing-data
 * warnings. The action cards are rendered separately by ActionCardList.
 */
interface Props {
  answer: AnswerEnvelope;
}

export function AIAnswerBlock({ answer }: Props) {
  return (
    <div
      className="rounded-md border border-border-subtle bg-surface-1 p-4"
      data-testid="ai-answer-block"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium capitalize text-accent">
          {answer.mode.replace("_", " ")}
        </span>
      </div>

      <h3 className="text-[14px] font-semibold text-txt-primary">Conclusion</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-txt-secondary">
        {answer.conclusion}
      </p>

      {answer.basis.length > 0 ? (
        <div className="mt-4" data-testid="ai-answer-basis">
          <h4 className="text-[12px] font-medium uppercase tracking-wide text-txt-tertiary">
            Basis
          </h4>
          <ul className="mt-1.5 flex flex-col gap-1">
            {answer.basis.map((b, i) => (
              <li key={i} className="text-[12px] text-txt-secondary">
                <span className="font-mono text-txt-primary">{b.entity}</span>
                {" — "}
                {b.fact}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.risks.length > 0 ? (
        <div className="mt-4" data-testid="ai-answer-risks">
          <h4 className="text-[12px] font-medium uppercase tracking-wide text-txt-tertiary">
            Risks
          </h4>
          <ul className="mt-1.5 flex flex-col gap-1">
            {answer.risks.map((r, i) => (
              <li
                key={i}
                className="flex gap-1.5 text-[12px] text-warning"
              >
                <span aria-hidden>⚠</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.missing_data.length > 0 ? (
        <div
          className="mt-4 rounded-md border border-warning/30 bg-warning/5 p-2.5"
          data-testid="ai-answer-missing"
        >
          <h4 className="text-[12px] font-medium uppercase tracking-wide text-warning">
            Missing data
          </h4>
          <ul className="mt-1.5 flex flex-col gap-1">
            {answer.missing_data.map((m, i) => (
              <li key={i} className="text-[12px] text-txt-secondary">
                {m}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
