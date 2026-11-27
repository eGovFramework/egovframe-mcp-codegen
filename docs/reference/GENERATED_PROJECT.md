# 생성되는 프로젝트

이 문서는 `egov_scaffold_project` 가 만드는 프로젝트의 구조, 실행 방법, 화면의 URL, 운영 DB 로 전환하는 방법을 스택별로 설명합니다.

## 스택별 구성

| 항목 | 5.1 Boot | 4.3 Boot | 4.3 WAR |
|------|----------|----------|---------|
| 부모 POM | `org.egovframe.boot:egovframe-boot-starter-parent:5.1.0` | `org.egovframe.boot:org.egovframe.boot.starter.parent:4.3.2` | `org.egovframe.web:org.egovframe.web.config.parent:4.3.2` |
| Java | 17 | 8 | 8 |
| 기반 | Spring Boot 3.5 (Jakarta EE) | Spring Boot 2.7 (Java EE) | Spring 5.3 (Java EE) |
| 패키징 | 실행 가능한 JAR | 실행 가능한 JAR | WAR |
| 화면 | Thymeleaf | Thymeleaf | JSP |
| 설정 방식 | Java 설정 클래스 (`config/EgovConfig*.java`) | Java 설정 클래스 | XML (`egovframework/spring/context-*.xml`, `dispatcher-servlet.xml`) |
| 유효성 검증 | Bean Validation(`@Valid`)과 화면의 `EgovValidation.js` | Bean Validation(`@Valid`), 오류는 화면에 서버 메시지로 표시 | commons-validator (`validator.xml`), 서버와 화면에서 모두 검증 |
| 보안 설정 | Spring Security (헤더, CSRF, 방화벽, CORS) | 없음 | 없음 |
| 첨부파일 | 지원 | 지원 | 지원하지 않음 |

의존성의 버전은 부모 POM 이 관리하므로, 생성되는 `pom.xml` 의 의존성에는 버전을 적지 않습니다.

## 디렉터리 구조

`projectName` 이 `board-app`, `packageName` 이 `egovframework.example.board`, `entityName` 이 `Board` 일 때의 구조입니다.

### 5.1 Boot, 4.3 Boot

```text
board-app/
├── pom.xml
└── src/main/
    ├── java/egovframework/example/
    │   ├── EgovBootApplication.java            애플리케이션 진입점
    │   ├── config/                             데이터소스, MyBatis, 트랜잭션, 웹, 메시지, 검증 설정
    │   │   ├── EgovConfigBoardIdGeneration.java   엔티티별 ID 채번 설정
    │   │   └── EgovConfigWebSecurity.java         보안 설정 (5.1 Boot 에만 있음)
    │   ├── cmm/                                공용 클래스 (콤보 상자용 VO, 5.1 Boot 의 CSRF 처리)
    │   ├── exception/                          예외 처리
    │   ├── pagination/                         KRDS 페이지네이션 렌더러
    │   ├── validation/                         필수 입력 검증 어노테이션 (4.3 Boot 에만 있음)
    │   └── board/                              엔티티 모듈
    │       ├── service/                        BoardVO, BoardDefaultVO, EgovBoardService
    │       ├── service/impl/                   EgovBoardServiceImpl, BoardMapper
    │       └── web/                            EgovBoardController
    └── resources/
        ├── application.properties              포트, 프로파일, 보안 설정 등
        ├── log4j2.xml
        ├── db/
        │   ├── boarddb.sql                     내장 HSQLDB 의 시드 SQL
        │   └── migrations/<dialect>/boarddb.sql   운영 DB 용 SQL (7개 DBMS)
        ├── egovframework/
        │   ├── egovProps/globals.properties    운영 DB 접속 정보
        │   ├── message/                        메시지 번들 (기본, _ko, _en)
        │   └── sqlmap/board/mappers/           MyBatis SQL
        ├── static/                             KRDS 정적 자산 (css, js, img, fonts)
        └── templates/thymeleaf/                화면 템플릿
```

화면 템플릿의 위치는 두 스택이 다릅니다. 5.1 Boot 는 `templates/thymeleaf/board/` 처럼 모듈 디렉터리 아래에, 4.3 Boot 는 `templates/thymeleaf/` 바로 아래에 만듭니다. 메뉴 fragment 는 두 스택 모두 `templates/thymeleaf/_fragments/nav.html` 입니다.

### 4.3 WAR

```text
board-app/
├── pom.xml
└── src/main/
    ├── java/egovframework/example/
    │   ├── cmm/vo/                             콤보 상자용 VO
    │   ├── cmmn/                               예외 처리, 날짜 바인딩, KRDS 페이지네이션 렌더러
    │   └── board/                              엔티티 모듈 (구성은 Boot 와 같음)
    ├── resources/
    │   ├── log4j2.xml
    │   ├── db/                                 시드 SQL 과 운영 DB 용 SQL (구성은 Boot 와 같음)
    │   └── egovframework/
    │       ├── egovProps/globals.properties
    │       ├── message/
    │       ├── spring/context-*.xml            데이터소스, MyBatis, 트랜잭션, 검증 등의 설정
    │       │   └── context-board-idgen.xml     엔티티별 ID 채번 설정
    │       └── sqlmap/board/mappers/
    └── webapp/
        ├── index.jsp                           첫 엔티티의 목록 화면으로 이동
        ├── css/, js/, img/, fonts/             KRDS 정적 자산
        └── WEB-INF/
            ├── web.xml
            ├── config/egovframework/springmvc/dispatcher-servlet.xml
            ├── config/egovframework/validator/validator.xml
            └── jsp/
                ├── _fragments/nav.jsp
                └── egovframework/example/board/   egovBoardList.jsp, egovBoardRegister.jsp
```

## 빌드와 실행

생성된 프로젝트는 기본 프로파일(`hsql`)에서 내장 HSQLDB 를 사용하므로, DB 를 준비하지 않고 바로 실행할 수 있습니다. 시작할 때 시드 SQL(`src/main/resources/db/<첫 엔티티>db.sql`)이 실행되어 테이블이 만들어지며, 데이터는 메모리에만 있어서 종료하면 사라집니다.

### 5.1 Boot, 4.3 Boot

```bash
cd board-app
mvn clean package
mvn spring-boot:run
```

5.1 Boot 는 JDK 17, 4.3 Boot 는 JDK 8 로 빌드하고 실행합니다. 브라우저에서 `http://localhost:8080/` 에 접속하면 첫 엔티티의 목록 화면이 보입니다. 포트는 `application.properties` 의 `server.port` 로 바꿉니다.

`mvn clean package` 가 만든 `target/board-app-1.0.0.jar` 를 `java -jar` 로 실행해도 됩니다.

### 4.3 WAR

```bash
cd board-app
mvn clean package
```

JDK 8 로 빌드합니다. 빌드 결과는 `target/board-app-1.0.0.war` 이며, 이 파일을 Tomcat 의 `webapps/` 에 복사한 뒤 Tomcat 을 시작합니다. Tomcat 은 WAR 파일의 이름을 컨텍스트 경로로 사용하므로, 접속 주소는 `http://localhost:8080/board-app-1.0.0/` 입니다. 파일 이름을 `board-app.war` 로 바꿔서 복사하면 주소는 `http://localhost:8080/board-app/` 가 됩니다.

이 저장소에서는 Tomcat 8.5 로 동작을 확인했습니다.

## 화면과 URL

엔티티 하나에 목록 화면과 등록(수정) 화면이 생성됩니다. 등록과 수정은 같은 화면을 사용합니다. 아래 표에서 `<E>` 는 엔티티 이름(예: `Board`), `<e>` 는 첫 글자를 소문자로 바꾼 이름(예: `board`)입니다.

| 기능 | 5.1 Boot | 4.3 Boot | 4.3 WAR |
|------|----------|----------|---------|
| 목록 | `GET /egov<E>List.do` | `GET /egov<E>List.do` | `GET /egov<E>List.do` |
| 목록의 검색과 페이지 이동 | 같은 URL 에 GET 으로 제출 | `POST /<e>/list` (목록 영역만 교체) | 같은 URL 에 GET 으로 제출 |
| 등록 화면 | `POST /add<E>View.do` | `GET /<e>/add` | `GET /add<E>.do` |
| 등록 | `POST /add<E>.do` | `POST /<e>/add` | `POST /add<E>.do` |
| 수정 화면 | `POST /update<E>View.do` | `POST /<e>/detail` | `GET /update<E>View.do?selectedId=<기본 키>` |
| 수정 | `POST /update<E>.do` | `POST /<e>/update` | `POST /update<E>.do` |
| 삭제 | `POST /delete<E>.do` | `POST /<e>/delete` | `POST /delete<E>.do` |
| 조회 화면 (`egov_add_query_view`) | `GET /egov<View>List.do` | `GET /egov<View>List.do` | `GET /egov<View>List.do` |

- 5.1 Boot 의 POST 요청에는 CSRF 토큰이 필요합니다. 토큰이 없으면 403 으로 응답합니다.
- 목록의 검색 조건(`searchCondition`)은 컬럼 이름이 아니라 검색 가능 컬럼의 순번(0부터 시작)입니다.
- 한 페이지에는 10건을 표시합니다.

### 화면의 구성

- 세 스택의 화면은 모두 KRDS(대한민국 정부 디자인 시스템)의 마크업과 정적 자산을 사용합니다. 자산은 Boot 에서 `src/main/resources/static/`, WAR 에서 `src/main/webapp/` 아래에 들어갑니다.
- 날짜 컬럼(`DATE`, `TIME`, `DATETIME`, `TIMESTAMP`)의 입력란에는 달력 선택기(flatpickr 4.6.13)가 붙습니다. flatpickr 는 CDN(`cdn.jsdelivr.net`)에서 불러오므로, 인터넷에 연결되지 않은 환경에서는 달력이 뜨지 않고 `yyyy-MM-dd` 형식으로 직접 입력해야 합니다.
- 메뉴는 `_fragments/nav` 파일 하나에 있고, 각 목록 화면이 이 파일을 포함합니다. `egov_add_entity` 의 `autoApplyMenu` 와 `egov_add_query_view` 가 이 파일을 다시 만듭니다.
- 화면의 문구는 메시지 번들(`egovframework/message/message-common*.properties`)에서 가져옵니다. 라벨을 바꾸려면 번들의 값을 고칩니다. 4.3 WAR 의 번들에는 한글을 `\uXXXX` 형태로 적어야 합니다.

## 기본 키 채번

엔티티의 기본 키는 `EgovTableIdGnrServiceImpl` 이 `<테이블 이름>-NNNNN` 형식으로 만듭니다(예: `BOARD-00001`). 채번의 현재 값은 `IDS` 테이블에 테이블 이름별로 저장되며, 시드 SQL 과 마이그레이션 SQL 에 `IDS` 테이블과 초기 행이 들어 있습니다.

엔티티마다 채번 빈이 따로 등록됩니다. Boot 는 `config/EgovConfig<E>IdGeneration.java`, WAR 는 `egovframework/spring/context-<e>-idgen.xml` 에 있습니다.

## 운영 DB 로 전환

1. `src/main/resources/egovframework/egovProps/globals.properties` 에서 사용할 DBMS 항목의 주석을 풀고 접속 정보를 입력합니다.
2. 프로파일을 바꿉니다. Boot 는 `application.properties` 의 `spring.profiles.active`, WAR 는 `web.xml` 의 `spring.profiles.active` 값을 고칩니다. 사용할 수 있는 값은 `oracle`, `mysql`, `maria`, `postgres`, `tibero`, `altibase`, `cubrid`, `goldilocks` 입니다.
3. `pom.xml` 에 JDBC 드라이버 의존성을 추가합니다. Oracle, MySQL, MariaDB, PostgreSQL 의 드라이버는 주석으로 들어 있으므로 주석을 풉니다. Tibero, Altibase, CUBRID, Goldilocks 의 드라이버는 Maven Central 에 없으므로, 제조사에서 받은 드라이버를 직접 추가합니다.
4. `src/main/resources/db/migrations/<dialect>/` 의 SQL 을 운영 DB 에 적용합니다. 이 SQL 은 자동으로 실행되지 않습니다. MariaDB 에는 `mysql` 디렉터리의 SQL 을 사용합니다.
5. Oracle, Tibero, Altibase 로 전환할 때에는 MyBatis SQL(`egovframework/sqlmap/**/*.xml`)의 두 부분을 고칩니다. 목록 조회의 페이징 구문(`LIMIT ... OFFSET ...`)과 검색 조건의 `CONCAT('%', ..., '%')` 는 이 DBMS 들에서 동작하지 않으며, 바꿀 구문이 각 SQL 파일의 주석에 적혀 있습니다.
6. 첨부파일 인프라를 설치했으면 `EgovFileMng_SQL.xml` 을 확인합니다. 이 SQL 은 MySQL 문법의 `SYSDATE()` 와 `IFNULL` 을 사용하며, DBMS 별로 나뉘어 있지 않습니다. 내장 HSQLDB, MySQL, MariaDB 가 아닌 DBMS 로 전환할 때에는 해당 DBMS 의 함수(예: `CURRENT_TIMESTAMP`, `COALESCE`)로 바꿉니다.

5.1 Boot 의 `globals.properties` 는 계정과 비밀번호를 환경 변수(`DB_ORACLE_USER`, `DB_ORACLE_PASSWORD` 등)에서 읽도록 되어 있습니다. 접속 정보를 평문으로 적어서 저장소에 올리지 않도록 합니다.

## 생성한 뒤에 확인할 것

- **인증과 권한**: 생성된 프로젝트에는 로그인과 권한 관리가 없습니다. 5.1 Boot 의 보안 설정도 모든 요청을 허용합니다. 운영하기 전에 프로젝트의 인증 체계를 추가해야 합니다.
- **첨부파일**: 저장 경로(`Globals.fileStorePath`)의 기본값은 운영체제의 임시 디렉터리이며, 다운로드 URL 에는 접근 제어가 없습니다. [첨부파일 인프라와 엔티티 연결 구조](../architecture/ATTACH_FILE.md)의 "인프라가 제공하지 않는 것"을 확인합니다.
- **로그 수준**: 4.3 Boot 와 4.3 WAR 의 `log4j2.xml` 은 애플리케이션 로그를 DEBUG 로 출력합니다. 5.1 Boot 는 `hsql` 프로파일에서만 DEBUG 이고 다른 프로파일에서는 INFO 입니다.
