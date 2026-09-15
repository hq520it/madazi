{{/* 名称与镜像辅助 */}}
{{- define "madazi.ns" -}}
{{ .Values.namespace | default .Release.Namespace }}
{{- end -}}

{{- define "madazi.image" -}}
{{- $root := index . "root" -}}
{{- $image := index . "image" -}}
{{- $tag := index . "tag" -}}
{{- with $root.Values.image.registry }}{{ . }}/{{ end }}{{ $image }}:{{ $tag }}
{{- end -}}

{{- define "madazi.serverImage" -}}
{{- include "madazi.image" (dict "root" . "image" "madazi-server" "tag" .Values.tags.server) -}}
{{- end -}}

{{- define "madazi.dshWebImage" -}}
{{- include "madazi.image" (dict "root" . "image" "madazi-dsh-web" "tag" .Values.tags.dshWeb) -}}
{{- end -}}

{{- define "madazi.dshImage" -}}
{{- include "madazi.image" (dict "root" . "image" "madazi-dsh" "tag" .Values.tags.dsh) -}}
{{- end -}}

{{- define "madazi.previewRuntimeImage" -}}
{{- include "madazi.image" (dict "root" . "image" "madazi-preview-runtime" "tag" .Values.tags.previewRuntime) -}}
{{- end -}}

{{- define "madazi.llmGatewayImage" -}}
{{- include "madazi.image" (dict "root" . "image" "madazi-llm-gateway" "tag" .Values.tags.llmGateway) -}}
{{- end -}}

{{- define "madazi.secretName" -}}
{{- .Values.secrets.existingSecret | default "madazi-secret" -}}
{{- end -}}

{{- define "madazi.storageClass" -}}
{{- with .Values.storage.className }}storageClassName: {{ . }}{{- end -}}
{{- end -}}
