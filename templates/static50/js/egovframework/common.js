const contextPath = $('#contextPathHolder').attr('data-contextPath') ? $('#contextPathHolder').attr('data-contextPath') : '';

function notNullCheck(value) {
    return !(value === '' || value == null || (typeof value == 'object' && !Object.keys(value).length));
}

// 키보드 접근성 — onclick 만 있는 비네이티브 요소(span, div 등)에서 Enter 를 클릭으로 위임한다.
// 버튼·링크·input 은 브라우저가 Enter 를 네이티브 click 으로 처리하므로 여기서 또 부르면 두 번 실행된다.
document.addEventListener("keydown", function(event) {
    if (event.key === "Enter") {
        const targetElement = event.target;
        if (targetElement.hasAttribute("onclick") && ['BUTTON', 'A', 'INPUT'].indexOf(targetElement.tagName) === -1) {
            targetElement.onclick();
        }
    }
});

