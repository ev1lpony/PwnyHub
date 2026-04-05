import React from "react";

export default function ActionsTable({
  filteredActions,
  selectedActionKey,
  setSelectedActionKey,
  cols,
  hasRisk,
  toggleSort,
  sortMark,
  riskStyle,
  pillStyle,
  fmtInt,
  fmtMs,
  tableScrollRef,
}) {
  return (
    <div className="ph-tableWrap">
      <div className="ph-tableScroll" ref={tableScrollRef}>
        <table className="ph-table">
          <thead>
            <tr>
              {cols.count ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("count")}>
                  Count{sortMark("count")}
                </th>
              ) : null}

              {hasRisk && cols.risk ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("risk")}>
                  Risk{sortMark("risk")}
                </th>
              ) : null}

              {cols.method ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("method")}>
                  Method{sortMark("method")}
                </th>
              ) : null}

              {cols.host ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("host")}>
                  Host{sortMark("host")}
                </th>
              ) : null}

              {cols.path ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("path")}>
                  Path template{sortMark("path")}
                </th>
              ) : null}

              {cols.mime ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("mime")}>
                  Top MIME{sortMark("mime")}
                </th>
              ) : null}

              {cols.statuses ? <th>Statuses</th> : null}

              {cols.bytes ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("bytes")}>
                  Avg bytes{sortMark("bytes")}
                </th>
              ) : null}

              {cols.time ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("time")}>
                  Avg ms{sortMark("time")}
                </th>
              ) : null}

              {cols.body ? (
                <th style={{ cursor: "pointer" }} onClick={() => toggleSort("body")}>
                  Body?{sortMark("body")}
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {filteredActions.map((a) => {
              const isSel = a.key === selectedActionKey;
              const tags = Array.isArray(a.risk_tags) ? a.risk_tags : [];
              const miniTag = tags.includes("scope_unset")
                ? "scope_unset"
                : tags.includes("out_of_scope")
                  ? "out_of_scope"
                  : tags.includes("third_party")
                    ? "third_party"
                    : tags.includes("denylisted_host")
                      ? "denylisted"
                      : "";

              return (
                <tr
                  key={a.key}
                  data-rowkey={a.key}
                  onClick={() => setSelectedActionKey(a.key)}
                  className={`ph-tr ${isSel ? "selected" : ""}`}
                  title={tags?.length ? `tags: ${tags.join(", ")}` : ""}
                >
                  {cols.count ? <td>{a.count}</td> : null}

                  {hasRisk && cols.risk ? (
                    <td>
                      <span style={riskStyle(a.risk_score)}>{fmtInt(a.risk_score)}</span>
                      {miniTag ? (
                        <span style={{ marginLeft: 8, ...pillStyle("#2a2020", "#ffd2d2") }}>
                          {miniTag}
                        </span>
                      ) : null}
                    </td>
                  ) : null}

                  {cols.method ? <td>{a.method}</td> : null}
                  {cols.host ? <td className="ph-mono">{a.host}</td> : null}
                  {cols.path ? <td className="ph-mono">{a.path_template}</td> : null}
                  {cols.mime ? <td className="ph-mono">{a.top_mime}</td> : null}

                  {cols.statuses ? (
                    <td>
                      {(a.status_codes || []).slice(0, 6).join(", ")}
                      {(a.status_codes || []).length > 6 ? "…" : ""}
                    </td>
                  ) : null}

                  {cols.bytes ? <td>{fmtInt(a.avg_resp_bytes)}</td> : null}
                  {cols.time ? <td>{fmtMs(a.avg_time_ms)}</td> : null}
                  {cols.body ? <td>{a.has_body ? "yes" : ""}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
