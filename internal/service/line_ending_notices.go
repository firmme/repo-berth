package service

import (
	"strings"

	"repo-berth/internal/model"
)

// Format notices share the persisted task history, so dismissing the transient
// notification never discards the explanation of which bytes were changed.
func (s *Service) recordLineEndingNotice(checkout string, changes []string) error {
	if len(changes) == 0 {
		return nil
	}
	now := model.Now()
	notice := model.Task{
		ID: model.ID(), Kind: "line_endings", Target: checkout, State: "succeeded",
		StartedAt: now, FinishedAt: now, Progress: strings.Join(changes, "\n"),
	}
	for _, change := range changes {
		notice.Logs = append(notice.Logs, model.TaskLog{At: now, Message: change})
	}
	return s.change(func(st *model.State) error {
		st.Tasks = append([]model.Task{notice}, st.Tasks...)
		kept := make([]model.Task, 0, len(st.Tasks))
		for _, task := range st.Tasks {
			if len(kept) < 200 || task.State == "running" || task.State == "queued" {
				kept = append(kept, task)
			}
		}
		st.Tasks = kept
		return nil
	})
}

type indexedLineEndings struct {
	hash, index, worktree string
}

func (s *Service) indexedLineEndings(path string, files []string) (map[string]indexedLineEndings, error) {
	args := append([]string{"ls-files", "--stage", "--eol", "-z", "--"}, files...)
	raw, err := s.runner().Run(s.ctx, path, nil, nil, args...)
	if err != nil {
		return nil, err
	}
	result := map[string]indexedLineEndings{}
	for _, row := range strings.Split(raw, "\x00") {
		cols := strings.SplitN(row, "\t", 3)
		if len(cols) != 3 {
			continue
		}
		entry, eol := strings.Fields(cols[0]), strings.Fields(cols[1])
		if len(entry) != 3 || entry[2] != "0" || len(eol) < 2 {
			continue
		}
		result[cols[2]] = indexedLineEndings{entry[1], strings.TrimPrefix(eol[0], "i/"), strings.TrimPrefix(eol[1], "w/")}
	}
	return result, nil
}

func (s *Service) stageWithLineEndingNotice(c model.LocalCheckout, files []string, stage func() error) error {
	before, err := s.indexedLineEndings(c.Path, files)
	if err != nil {
		return err
	}
	if err := stage(); err != nil {
		return err
	}
	after, err := s.indexedLineEndings(c.Path, files)
	if err != nil {
		return err
	}
	changes := []string{}
	label := map[string]string{"lf": "LF", "crlf": "CRLF", "mixed": "混合换行符"}
	for file, ending := range after {
		if ending.hash == before[file].hash || ending.index == ending.worktree || label[ending.index] == "" || label[ending.worktree] == "" {
			continue
		}
		changes = append(changes, file+"："+label[ending.worktree]+" → "+label[ending.index]+"（Git 暂存转换，工作文件保持原样）")
	}
	return s.recordLineEndingNotice(c.ID, changes)
}
