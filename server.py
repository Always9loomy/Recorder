"""Event Lab development server.

Run: python3 server.py
Open: http://localhost:3333
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import cgi
import json
import os
import time
import uuid
from urllib.parse import parse_qs


PORT = 3333
ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Recorder/viewer modules change frequently during development; never run stale privacy logic.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] != "/api/ajax-test":
            super().do_GET()
            return

        response = json.dumps({
            "ok": True,
            "message": "AJAX 요청이 정상적으로 처리되었습니다.",
            "serverTime": time.strftime("%Y-%m-%d %H:%M:%S"),
        }, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def do_POST(self):
        if self.path == "/api/ajax-test":
            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length).decode("utf-8")
            fields = parse_qs(raw_body, keep_blank_values=True)
            try:
                header_value = fields.get("header", ["{}"]).pop()
                body_value = fields.get("body", ["{}"]).pop()
                header = json.loads(header_value)
                body = json.loads(body_value)
            except (json.JSONDecodeError, TypeError):
                self.send_error(400, "Invalid header or body JSON")
                return

            response = json.dumps({
                "responseMessage": {
                    "header": header,
                    "body": {
                        "resultCode": "S000",
                        "resultMessage": "요청이 정상적으로 처리되었습니다.",
                        "confirmationId": f"CNF-{uuid.uuid4().hex[:12].upper()}",
                        "status": "COMPLETED",
                        "processedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    },
                },
            }, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            return

        if self.path != "/api/test":
            self.send_error(404, "Not found")
            return

        if self.headers.get_content_type() != "multipart/form-data":
            self.send_error(400, "Expected multipart FormData request")
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers["Content-Type"]},
        )
        form_data = {key: form.getfirst(key, "") for key in form.keys()}
        try:
            delay_ms = max(0, min(int(form_data.get("delayMs", 0)), 15000))
            header = json.loads(form_data.get("header", "{}"))
            body = json.loads(form_data.get("body", "{}"))
            if not isinstance(header, dict) or not isinstance(body, dict):
                raise ValueError
        except (ValueError, TypeError):
            self.send_error(400, "Invalid delayMs, header, or body")
            return

        time.sleep(delay_ms / 1000)
        force_error = form_data.get("forceError") == "true"
        long_response = form_data.get("longResponse") == "true"
        empty_response_body = form_data.get("emptyResponseBody") == "true"
        error_flag_response_body = form_data.get("errorFlagResponseBody") == "true"
        response_body = {
            "resultCode": "E500" if force_error else "S000",
            "resultMessage": "요청 처리 중 오류가 발생했습니다." if force_error else "요청이 정상적으로 처리되었습니다.",
            "confirmationId": f"CNF-{uuid.uuid4().hex[:12].upper()}",
        }
        if long_response:
            response_body["summary"] = {
                "totalCount": 120,
                "successfulCount": 120,
                "description": "스크롤과 상세보기 검색 기능을 검증하기 위한 긴 응답 예시입니다.",
            }
            response_body["items"] = [
                {
                    "sequence": index,
                    "itemId": f"ITEM-{index:04d}",
                    "status": "COMPLETED",
                    "category": f"테스트 카테고리 {(index % 8) + 1}",
                    "description": f"긴 서버 응답의 {index}번째 테스트 항목입니다. 검색과 이전·다음 이동을 확인할 수 있습니다.",
                }
                for index in range(1, 121)
            ]
        if empty_response_body:
            response_body = {}
        if error_flag_response_body:
            response_body = {"isError": True, "resultMessage": "서버 응답 body에서 오류 플래그를 반환했습니다."}
        response = json.dumps({
            "ok": not force_error,
            "message": "의도적으로 오류 응답을 반환했습니다." if force_error else "POST 요청을 정상적으로 처리했습니다.",
            "delayMs": delay_ms,
            "responseMessage": {"header": header, "body": response_body},
        }, ensure_ascii=False).encode("utf-8")
        self.send_response(500 if force_error else 200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


if __name__ == "__main__":
    os.chdir(ROOT)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Event Lab is running at http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()
