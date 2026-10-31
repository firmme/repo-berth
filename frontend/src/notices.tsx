import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Package,
  Search,
} from "lucide-react";
import { api, errorMessage } from "./api";
import { ErrorNotice, Loading } from "./components";
import "./notices.css";

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export function NoticesView() {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const notices = useQuery({
    queryKey: ["notices"],
    queryFn: () => api("ThirdPartyNotices"),
    staleTime: Infinity,
  });
  const dependencies = useMemo(() => {
    const words = query.trim().toLowerCase();
    return (notices.data?.dependencies || []).filter((dependency) =>
      `${dependency.ecosystem}/${dependency.name} ${dependency.version} ${dependency.declaredLicense || ""}`
        .toLowerCase()
        .includes(words),
    );
  }, [notices.data?.dependencies, query]);
  if (notices.isPending) return <Loading />;
  if (notices.isError)
    return <ErrorNotice message={errorMessage(notices.error)} />;
  const data = notices.data;
  const links = data?.links || {};
  return (
    <div className="notices-view">
      <div className="notices-summary">
        <FileText size={18} />
        <div>
          <strong>第三方许可已内嵌到应用</strong>
          <span>
            {data?.dependencies.length || 0} 个依赖 · 压缩后{" "}
            {formatSize(data?.compressed || 0)} · 生成于{" "}
            {data?.generatedAt
              ? new Date(data.generatedAt).toLocaleString("zh-CN")
              : "未知"}
          </span>
        </div>
      </div>
      <div className="notices-links">
        {links.repository && (
          <button onClick={() => void api("OpenLink", links.repository)}>
            <ExternalLink size={13} />
            项目仓库
          </button>
        )}
        {links.releases && (
          <button onClick={() => void api("OpenLink", links.releases)}>
            <ExternalLink size={13} />
            Releases
          </button>
        )}
        {links.issues && (
          <button onClick={() => void api("OpenLink", links.issues)}>
            <ExternalLink size={13} />
            问题反馈
          </button>
        )}
      </div>
      <label className="notices-search">
        <Search size={14} />
        <input
          aria-label="筛选第三方依赖"
          placeholder="筛选依赖或许可证…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="notices-list">
        {dependencies.map((dependency) => {
          const key = `${dependency.ecosystem}:${dependency.name}@${dependency.version}`;
          const open = expanded.has(key);
          return (
            <div className="notices-dependency" key={key}>
              <button
                type="button"
                className="notices-dependency-head"
                aria-expanded={open}
                onClick={() =>
                  setExpanded((old) => {
                    const next = new Set(old);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                {open ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
                <Package size={14} />
                <span>
                  <strong>{dependency.name}</strong>
                  <small>
                    {dependency.ecosystem} · {dependency.version}
                    {dependency.declaredLicense
                      ? ` · ${dependency.declaredLicense}`
                      : ""}
                  </small>
                </span>
                <em>{dependency.licenses.length} 个许可文件</em>
              </button>
              {open && (
                <div className="notices-license-list">
                  {dependency.repository && (
                    <button
                      type="button"
                      className="notices-repository"
                      onClick={() =>
                        void api("OpenLink", dependency.repository!)
                      }
                    >
                      <ExternalLink size={12} />
                      {dependency.repository}
                    </button>
                  )}
                  {dependency.provenance && (
                    <p className="notices-note">{dependency.provenance}</p>
                  )}
                  {dependency.licenses.map((license) => (
                    <details key={license.source}>
                      <summary>
                        <FileText size={13} />
                        {license.source}
                        <code>{license.sha256.slice(0, 12)}</code>
                      </summary>
                      <pre>{license.text}</pre>
                    </details>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {!dependencies.length && (
          <p className="notices-empty">没有匹配的依赖</p>
        )}
      </div>
    </div>
  );
}
